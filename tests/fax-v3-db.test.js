import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {databaseOptions} from '../server/auth/database.js';
import {FaxStore} from '../server/fax-v3/store.js';
import {FaxService} from '../server/fax-v3/service.js';
import {RcService} from '../server/ringcentral-v3/service.js';
import {encrypt,tokenContext} from '../server/ringcentral-v3/crypto.js';
import {validateSubmission} from '../server/fax-v3/safety.js';
import {createFaxHandler} from '../server/fax-v3/handler.js';
import {hash,randomToken} from '../server/auth/security.js';
import {assertDevelopment} from '../scripts/rc-v3-development-guard.mjs';
import {config,token} from './rc-v3-fixtures.js';

test('Development-only PostgreSQL fax ownership, durable attempts and mocked operations',{skip:process.env.RC_V3_DB_TEST!=='1',timeout:120000},async t=>{
  assertDevelopment(process.env);
  const suffix=randomUUID().replaceAll('-',''),schema='fax_test_'+suffix,auth='fax_test_auth_'+suffix;
  const pool=new pg.Pool(databaseOptions()),pool2=new pg.Pool(databaseOptions());pool.on('error',()=>{});pool2.on('error',()=>{});
  const c=config(),store=new FaxStore(pool,schema,auth),store2=new FaxStore(pool2,schema,auth);let setup=false,calls=0,status='Queued',failure=false,refreshes=0;
  const provider={send:async()=>{calls++;if(failure)throw Error('synthetic private diagnostic');return {messageId:String(100000+calls),status};},message:async()=>({messageStatus:status}),receipt:async()=>Buffer.from('%PDF-synthetic'),contacts:async row=>[{id:'1',name:'Synthetic',numbers:[row.extension_id]}],createContact:async row=>({id:'2',name:row.extension_id,numbers:['+18015551234']})};
  const rcProvider={refresh:async()=>{refreshes++;return {...token(),ownerId:null};}};
  const service=new FaxService(c,store,new RcService(c,store,rcProvider),provider),service2=new FaxService(c,store2,new RcService(c,store2,rcProvider),provider);
  const input=()=>validateSubmission({filename:'Synthetic.pdf',lastFour:'0012',faxNumber:'+18015551234',recipientName:'Synthetic',coverPageText:'PRIVATE COVER COMMENT',includeCoverSheet:true,idempotencyKey:randomUUID()},Buffer.from('%PDF-synthetic'));
  try {
    for(const name of ['001_toolkit_auth','002_ringcentral_v3','003_fax_v3_operations']){
      const sql=await readFile(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8');
      await pool.query(sql.replaceAll('toolkit_auth',auth).replaceAll('toolkit_rc_v3',schema));setup=true;
    }
    let extension=30000;
    const makeUser=async()=>{
      const user=randomUUID(),cookie=randomToken(),session=hash(cookie),connection={id:randomUUID(),user_id:user,environment:'development',account_id:c.accountId,extension_id:String(++extension)};
      await pool.query(`INSERT INTO ${auth}.users(id,entra_tenant_id,entra_object_id,display_name) VALUES($1,$2,$3,'Synthetic')`,[user,randomUUID(),randomUUID()]);
      await pool.query(`INSERT INTO ${auth}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[session,user]);
      await pool.query(`INSERT INTO ${schema}.identities(environment,account_id,extension_id,user_id) VALUES($1,$2,$3,$4)`,['development',c.accountId,connection.extension_id,user]);
      await pool.query(`INSERT INTO ${schema}.connections(id,user_id,environment,account_id,extension_id,state,generation,token_envelope,access_expires_at,refresh_expires_at,display_name) VALUES($1,$2,$3,$4,$5,'connected',1,$6,now()+interval '1 hour',now()+interval '1 day','Synthetic')`,[connection.id,user,'development',c.accountId,connection.extension_id,encrypt({accessToken:'synthetic-access',refreshToken:'synthetic-refresh'},tokenContext(connection),c)]);
      return {user,session,cookie,config:c,context:(await service.context(user,session)).context,connection};
    };
    const a=await makeUser(),b=await makeUser();
    await t.test('independent instances submit identical idempotency key only once',async()=>{
      const data=input(),before=calls;const results=await Promise.all([service.send(a,data),service2.send(a,data)]);assert.equal(calls,before+1);assert.equal(results[0].faxId,results[1].faxId);
      const again=await service.send(a,data);assert.equal(again.faxId,results[0].faxId);assert.equal(calls,before+1);
      await assert.rejects(service.send(a,{...data,requestHash:'a'.repeat(64)}));
      const raw=(await pool.query(`SELECT * FROM ${schema}.fax_attempts WHERE id=$1`,[again.faxId])).rows[0];assert(!JSON.stringify(raw).includes('PRIVATE COVER COMMENT'));assert(!JSON.stringify(raw.metadata_envelope).includes('0012'));assert(!JSON.stringify(again).includes(raw.message_id));
    });
    await t.test('foreign and guessed fax IDs fail before any provider or refresh; contacts/history isolate employees',async()=>{
      status='Sent';const owned=await service.send(a,input());const before=calls;
      for(const id of [owned.faxId,randomUUID()]){await assert.rejects(service.fax(b,id));await assert.rejects(service.fax(b,id,true));}
      assert.equal(calls,before);assert.equal(refreshes,0);assert.equal((await store.history(b)).length,0);
      const ca=await service.contacts(a),cb=await service.contacts(b);assert.notDeepEqual(ca,cb);
      assert.equal((await service.contacts(a,{name:'Synthetic',faxNumber:'+18015551234'})).name,a.connection.extension_id);
      const receipt=await service.fax(a,owned.faxId,true);assert(receipt.bytes.subarray(0,5).equals(Buffer.from('%PDF-')));
      assert.equal((await service.fax(a,owned.faxId)).status,'Sent');
      for(const action of ['status','message','receipt']) {
        const req={method:'GET',url:'/api/fax-v3/'+action+'?faxId='+owned.faxId,headers:{cookie:'toolkit_session='+b.cookie,'x-toolkit-fax-context':b.context}};
        const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;},end(){}};
        await createFaxHandler(action,{config:c,authConfig:{origin:c.origin,sessionCookie:'toolkit_session'},requireUser:async()=>({id:b.user}),store,service})(req,res);assert.equal(res.code,404);
      }
    });
    await t.test('ambiguous provider acknowledgement persists Unknown and never replays duplicate or retry',async()=>{
      failure=true;const data=input(),before=calls;const result=await service.send(a,data);failure=false;
      assert.equal(result.status,'Unknown');assert.equal(result.retryable,false);assert.equal(calls,before+1);
      await service.send(a,data);assert.equal(calls,before+1);await assert.rejects(service.send(a,{...data,idempotencyKey:randomUUID(),retryOf:result.faxId}));
      assert.equal((await pool.query(`SELECT state FROM ${schema}.fax_attempts WHERE id=$1`,[result.faxId])).rows[0].state,'unknown');
    });
    await t.test('only definitive SendingFailed permits one explicit retry with identical payload',async()=>{
      status='SendingFailed';const data=input(),result=await service.send(a,data);assert.equal(result.retryable,true);
      const retry={...data,idempotencyKey:randomUUID(),retryOf:result.faxId};status='Sent';await service.send(a,retry);const before=calls;
      await assert.rejects(service.send(a,{...retry,idempotencyKey:randomUUID()}));assert.equal(calls,before);
      assert.equal((await service.fax(a,result.faxId)).status,'SendingFailed');
    });
    await t.test('lost database COMMIT acknowledgement after provider acceptance never resends',async()=>{
      const data=input();let lose=false;
      const wrapped={connect:async()=>{const client=await pool.connect();return {release:()=>client.release(),query:async(...args)=>{const result=await client.query(...args);if(args[0]==='COMMIT'&&lose){lose=false;throw Error('synthetic lost COMMIT');}return result;}};},query:(...args)=>pool.query(...args)};
      const s=new FaxStore(wrapped,schema,auth);const p={...provider,send:async(...args)=>{const r=await provider.send(...args);lose=true;return r;}};
      const svc=new FaxService(c,s,new RcService(c,s,rcProvider),p),before=calls;
      const result=await svc.send(a,data);assert.equal(result.status,'Unknown');assert.equal(calls,before+1);const recovered=await svc.send(a,data);assert.equal(recovered.status,'Sent');assert.equal(calls,before+1);
    });
    await t.test('latest 20, newest first; encrypted Last 4 survives fresh store; no comments or PDFs retained',async()=>{
      for(let i=0;i<22;i++)await store.reserve(b,input());
      const history=await store2.history(b);assert.equal(history.length,20);assert(history.every(e=>e.lastFour==='0012'&&e.filename==='Synthetic.pdf'));assert(history.every((e,i)=>i===0||e.createdAt<=history[i-1].createdAt));
      assert(!JSON.stringify(history).includes('PRIVATE COVER COMMENT'));assert(!JSON.stringify(history).includes('%PDF'));
    });
    await t.test('refresh rotation cancels old context before fax provider; new context is explicit',async()=>{
      const f=await makeUser();await pool.query(`UPDATE ${schema}.connections SET access_expires_at=now()-interval '1 second' WHERE user_id=$1`,[f.user]);
      const before=calls,result=await service.send(f,input());assert.equal(result.status,'Unknown');assert.equal(calls,before);assert.equal(refreshes,1);
      await assert.rejects(service.contacts(f));const next={...f,context:(await service.context(f.user,f.session)).context};assert.notEqual(next.context,f.context);await service.contacts(next);
    });
    await t.test('disconnect/reconnect generation and revoked Toolkit session invalidate all old operations',async()=>{
      const f=await makeUser();await pool.query(`UPDATE ${schema}.connections SET generation=generation+1 WHERE user_id=$1`,[f.user]);
      for(const operation of [()=>store.history(f),()=>service.contacts(f),()=>service.send(f,input()),()=>service.fax(f,randomUUID()),()=>service.fax(f,randomUUID(),true)])await assert.rejects(operation());
      const next={...f,context:(await service.context(f.user,f.session)).context};await pool.query(`UPDATE ${auth}.sessions SET revoked_at=now() WHERE token_hash=$1`,[f.session]);await assert.rejects(store.history(next));await assert.rejects(service.contacts(next));await assert.rejects(service.send(next,input()));
    });
    await t.test('disconnect serializes behind an already-authorized provider send and fences subsequent work',async()=>{
      const f=await makeUser();let started,release;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r);
      const slow={...provider,send:async(...args)=>{started();await gate;return provider.send(...args);}};
      const svc=new FaxService(c,store,new RcService(c,store,rcProvider),slow);
      const sending=svc.send(f,input());await entered;let disconnected=false;
      const disconnecting=store2.disconnect(f.user,'development').then(row=>{disconnected=true;return row;});
      await new Promise(r=>setTimeout(r,100));assert.equal(disconnected,false);release();const result=await sending;await disconnecting;assert.equal(result.status,'Sent');
      await assert.rejects(service.contacts(f));await assert.rejects(service.send(f,input()));
    });
  } catch(error) {if(error?.code || error?.severity)throw Error('Development integration failed; database diagnostics withheld.');throw error;}
  finally {if(setup){await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>{});await pool.query(`DROP SCHEMA IF EXISTS ${auth} CASCADE`).catch(()=>{});}await pool.end();await pool2.end();}
});
