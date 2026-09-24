import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseOptions } from '../server/auth/database.js';
import { RcStore } from '../server/ringcentral-v3/store.js';
import { RcService } from '../server/ringcentral-v3/service.js';
import { hash,randomToken,challenge } from '../server/auth/security.js';
import { decrypt,tokenContext } from '../server/ringcentral-v3/crypto.js';
import { assertDevelopment } from '../scripts/rc-v3-development-guard.mjs';
import { config,token,identity } from './rc-v3-fixtures.js';

test('Development PostgreSQL RC isolation, OAuth and independent-instance refresh coordination',
  {skip:process.env.RC_V3_DB_TEST!=='1',timeout:120000},async t=>{
  assertDevelopment(process.env); // Before creating a pool or executing ANY SQL.
  const suffix=randomUUID().replaceAll('-',''),auth='rc_test_auth_'+suffix,schema='rc_test_'+suffix;
  const p=new pg.Pool(databaseOptions()),p2=new pg.Pool(databaseOptions());p.on('error',()=>{});p2.on('error',()=>{});
  const store=new RcStore(p,schema,auth),store2=new RcStore(p2,schema,auth),c=config();
  let setup=false;
  try{
    const a=await readFile(new URL('../migrations/001_toolkit_auth.sql',import.meta.url),'utf8');
    const b=await readFile(new URL('../migrations/002_ringcentral_v3.sql',import.meta.url),'utf8');
    // 001 is used only as a synthetic fixture in a random disposable schema, never applied to toolkit_auth.
    await p.query(a.replaceAll('toolkit_auth',auth));setup=true;
    await p.query(b.replaceAll('toolkit_rc_v3',schema).replaceAll('toolkit_auth',auth));
    const makeUser=async()=>{
      const id=randomUUID(),session=hash(randomToken());
      await p.query(`INSERT INTO ${auth}.users(id,entra_tenant_id,entra_object_id,display_name) VALUES($1,$2,$3,'Synthetic')`,[id,randomUUID(),randomUUID()]);
      await p.query(`INSERT INTO ${auth}.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[session,id]);return {id,session};
    };
    let extension=20000;
    const setupUser=async()=>{
      const u=await makeUser(),ident={...identity,extensionId:String(++extension)};
      const issued=()=>({...token(),ownerId:ident.extensionId});
      const provider={authorizationUrl:(state,ch)=>'https://example.invalid/?'+new URLSearchParams({state,code_challenge:ch}),exchange:async()=>issued(),identity:async()=>ident,refresh:async()=>issued(),revoke:async()=>{}};
      const service=new RcService(c,store,provider);
      const start=await service.connect(u.id,u.session);
      const state=new URL(start.url).searchParams.get('state');
      return {u,ident,issued,provider,service,start,state};
    };
    const finish=async f=>f.service.callback(f.u.id,f.u.session,f.state,f.start.binding,'synthetic-code');
    await t.test('wrong user, session and browser cannot consume transaction; correct PKCE single use',async()=>{
      const f=await setupUser(),other=await makeUser();let exchanges=0;
      f.provider.exchange=async(code,verifier)=>{exchanges++;assert.equal(challenge(verifier),new URL(f.start.url).searchParams.get('code_challenge'));return f.issued()};
      for(const args of [[other.id,other.session,f.state,f.start.binding],[f.u.id,other.session,f.state,f.start.binding],[f.u.id,f.u.session,f.state,randomToken()]])await assert.rejects(f.service.callback(...args,'code'));
      assert.equal(exchanges,0);
      const results=await Promise.allSettled([finish(f),finish(f)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(exchanges,1);
      const tx=(await p.query(`SELECT * FROM ${schema}.oauth_transactions WHERE state_hash=$1`,[hash(f.state)])).rows[0];assert.equal(tx.verifier_envelope,null);assert(tx.consumed_at);
      const row=await store.get(f.u.id,'development');assert.equal(row.state,'connected');assert(!JSON.stringify(row).includes('synthetic-access'));assert(!JSON.stringify(row).includes('synthetic-refresh'));
    });
    await t.test('expired, revoked, inactive and superseded OAuth transactions fail closed',async()=>{
      for(const kind of ['expired','revoked','inactive','superseded']){
        const f=await setupUser();
        if(kind==='expired')await p.query(`UPDATE ${schema}.oauth_transactions SET expires_at=now()-interval '1 second' WHERE state_hash=$1`,[hash(f.state)]);
        if(kind==='revoked')await p.query(`UPDATE ${auth}.sessions SET revoked_at=now() WHERE token_hash=$1`,[f.u.session]);
        if(kind==='inactive')await p.query(`UPDATE ${auth}.users SET active=false WHERE id=$1`,[f.u.id]);
        if(kind==='superseded')await f.service.connect(f.u.id,f.u.session);
        await assert.rejects(finish(f));
      }
    });
    await t.test('session revoked during code exchange cannot install tokens',async()=>{
      const f=await setupUser();let revoked=0;
      f.provider.exchange=async()=>{await p.query(`UPDATE ${auth}.sessions SET revoked_at=now() WHERE token_hash=$1`,[f.u.session]);return f.issued()};
      f.provider.revoke=async()=>revoked++;
      await assert.rejects(finish(f));assert.equal(revoked,1);assert.equal((await store.get(f.u.id,'development')).token_envelope,null);
    });
    await t.test('RC identity cannot be linked to two employees, including after disconnect',async()=>{
      const a=await setupUser(),b=await setupUser();await finish(a);
      b.provider.identity=async()=>a.ident;
      await assert.rejects(finish(b));
      await a.service.disconnect(a.u.id);
      b.start=await b.service.connect(b.u.id,b.u.session);b.state=new URL(b.start.url).searchParams.get('state');
      await assert.rejects(finish(b));
      const row=await store.get(a.u.id,'development');assert.equal(row.token_envelope,null);assert.equal(row.state,'disconnected');
      a.start=await a.service.connect(a.u.id,a.u.session);a.state=new URL(a.start.url).searchParams.get('state');await finish(a);
      assert.equal((await store.get(a.u.id,'development')).id,row.id);
    });
    await t.test('independent Vercel instances refresh exactly once and persist rotated tokens',async()=>{
      const f=await setupUser();await finish(f);
      await p.query(`UPDATE ${schema}.connections SET access_expires_at=now()-interval '1 second' WHERE user_id=$1`,[f.u.id]);
      let count=0;f.provider.refresh=async()=>{count++;await new Promise(r=>setTimeout(r,100));return {...f.issued(),accessToken:'rotated-access',refreshToken:'rotated-refresh'}};
      const another=new RcService(c,store2,f.provider);
      const results=await Promise.all([f.service.accessToken(f.u.id),another.accessToken(f.u.id)]);
      assert.deepEqual(results,['rotated-access','rotated-access']);assert.equal(count,1);
      const row=await store.get(f.u.id,'development');assert.equal(decrypt(row.token_envelope,tokenContext(row),c).refreshToken,'rotated-refresh');assert.equal(row.refresh_claim,null);
    });
    await t.test('lost database acknowledgement after refresh commit fails closed',async()=>{
      const f=await setupUser();await finish(f);await p.query(`UPDATE ${schema}.connections SET access_expires_at=now()-interval '1 second' WHERE user_id=$1`,[f.u.id]);
      const uncertainStore=Object.create(store);
      uncertainStore.refreshed=async(...args)=>{await store.refreshed(...args);throw Error('Lost acknowledgement')};
      await assert.rejects(new RcService(c,uncertainStore,f.provider).accessToken(f.u.id));
      assert.equal((await store.get(f.u.id,'development')).state,'needs_reconnect');
      await assert.rejects(f.service.accessToken(f.u.id));
    });
    await t.test('competing employees cannot concurrently claim one RC identity',async()=>{
      const a=await setupUser(),b=await setupUser();b.provider.identity=async()=>a.ident;
      const r=await Promise.allSettled([finish(a),finish(b)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
      const rows=await p.query(`SELECT user_id FROM ${schema}.connections WHERE account_id=$1 AND extension_id=$2 AND state='connected'`,[a.ident.accountId,a.ident.extensionId]);assert.equal(rows.rowCount,1);
    });
    await t.test('refresh failure and abandoned claims never replay tokens',async()=>{
      for(const abandoned of [false,true]){
        const f=await setupUser();await finish(f);await p.query(`UPDATE ${schema}.connections SET access_expires_at=now()-interval '1 second' WHERE user_id=$1`,[f.u.id]);
        let calls=0;f.provider.refresh=async()=>{calls++;throw Error('sensitive-upstream')};
        if(abandoned){const row=await store.get(f.u.id,'development');await store.claim(row);await p.query(`UPDATE ${schema}.connections SET refresh_deadline=now()-interval '1 second' WHERE user_id=$1`,[f.u.id]);}
        await assert.rejects(f.service.accessToken(f.u.id));await assert.rejects(f.service.accessToken(f.u.id));
        assert.equal(calls,abandoned?0:1);assert.equal((await store.get(f.u.id,'development')).state,'needs_reconnect');
      }
    });
    await t.test('disconnect waits for live refresh; stale claim cannot overwrite disconnect/reconnect',async()=>{
      const f=await setupUser();await finish(f);const old=await store.get(f.u.id,'development');const claim=await store.claim(old);
      await assert.rejects(f.service.disconnect(f.u.id));
      await p.query(`UPDATE ${schema}.connections SET refresh_deadline=now()-interval '1 second' WHERE user_id=$1`,[f.u.id]);
      await f.service.disconnect(f.u.id);
      f.start=await f.service.connect(f.u.id,f.u.session);f.state=new URL(f.start.url).searchParams.get('state');await finish(f);
      assert.equal(await store2.refreshed(claim,f.issued(),old.token_envelope),false);
      await store2.uncertain(claim);assert.equal((await store.get(f.u.id,'development')).state,'connected');
    });
    await t.test('disconnect fences OAuth callback and failed revocation stays disabled',async()=>{
      const f=await setupUser();
      f.provider.exchange=async()=>{await f.service.disconnect(f.u.id);return f.issued()};await assert.rejects(finish(f));
      const g=await setupUser();await finish(g);g.provider.revoke=async()=>{throw Error('private')};await assert.rejects(g.service.disconnect(g.u.id));
      assert.equal((await store.get(g.u.id,'development')).state,'disconnecting');await assert.rejects(g.service.accessToken(g.u.id));await assert.rejects(g.service.connect(g.u.id,g.u.session));
      g.provider.revoke=async()=>{};await g.service.disconnect(g.u.id);assert.equal((await store.get(g.u.id,'development')).token_envelope,null);
    });
    await t.test('ownership constraints reject cross-user fax records; no other user connection lookup',async()=>{
      const a=await setupUser(),b=await setupUser();await finish(a);await finish(b);const row=await store.get(a.u.id,'development');
      assert.equal(await store.get(randomUUID(),'development'),null);
      await assert.rejects(p.query(`INSERT INTO ${schema}.fax_attempts(id,user_id,connection_id,environment,account_id,extension_id,idempotency_key,request_hash,state)
        VALUES($1,$2,$3,'development',$4,$5,$6,$7,'prepared')`,[randomUUID(),b.u.id,row.id,a.ident.accountId,a.ident.extensionId,randomUUID(),'a'.repeat(64)]));
      await assert.rejects(p.query(`INSERT INTO ${schema}.connections(id,user_id,environment) VALUES($1,$2,'development')`,[randomUUID(),a.u.id]));
    });
  }catch(error){if(error.code==='ERR_ASSERTION')throw error;throw new Error('Development RC integration failed; diagnostics withheld');}
  finally{
    try{if(setup){await p.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await p.query(`DROP SCHEMA IF EXISTS ${auth} CASCADE`);}}
    catch{throw new Error('Synthetic Development schema cleanup failed');}
    finally{await p.end();await p2.end();}
  }
});
