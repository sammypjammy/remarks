import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {config} from './rc-v3-fixtures.js';
import {validateSubmission,receiptFilename,contextFor,checkContext,metadataContext,safeStatus} from '../server/fax-v3/safety.js';
import {encrypt,decrypt} from '../server/ringcentral-v3/crypto.js';
import {FaxProvider} from '../server/fax-v3/provider.js';
import {createFaxHandler,upload} from '../server/fax-v3/handler.js';
import {Scope,Batch,Poller,receiptZip,receiptFilename as browserFilename,number} from '../development/fax-sender-v3/client.js';
import {migrateFax} from '../scripts/migrate-fax-v3.mjs';
const pdf=Buffer.from('%PDF-1.4\nsynthetic only');
const fields=()=>({filename:'Brief.pdf',faxNumber:'+18015551234',lastFour:'0012',recipientName:'Recipient',includeCoverSheet:true,coverPageText:'  PRIVATE COMMENT  ',idempotencyKey:randomUUID()});
const row=()=>({id:randomUUID(),user_id:randomUUID(),environment:'development',account_id:'827653020',extension_id:'12345',generation:'5',state:'connected'});
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const contextual=fn=>(path,options)=>path==='/api/fax-v3/context'?response({state:'connected',context:'c'}):fn(path,options);
const file=()=>new File([pdf],'Brief.pdf',{type:'application/pdf',lastModified:1});
const settings=()=>({faxNumber:'+18015551234',lastFour:'0012',recipientName:'Recipient',includeCoverSheet:true,coverPageText:'  comment  '});
test('submission validation, immutable cover payload and metadata privacy',()=>{
  const f=fields(),input=validateSubmission(f,pdf);assert.equal(input.payload.coverIndex,5);assert.equal(input.payload.coverPageText,'PRIVATE COMMENT');assert.equal(input.payload.to[0].name,'Recipient');assert(!JSON.stringify(input.payload).includes('0012'));assert(!JSON.stringify(input.metadata).includes('COMMENT'));
  const off=validateSubmission({...f,includeCoverSheet:false},pdf);assert.equal(off.payload.coverIndex,0);assert(!Object.hasOwn(off.payload,'coverPageText'));
  for(const lastFour of ['123','12345','abcd',' 1234',''])assert.throws(()=>validateSubmission({...f,lastFour},pdf));
  assert.throws(()=>validateSubmission({...f,coverPageText:'😀'.repeat(513)},pdf));assert.throws(()=>validateSubmission({...f,token:'unexpected'},pdf));assert.throws(()=>validateSubmission(f,Buffer.from('not PDF')));assert.throws(()=>validateSubmission(f,Buffer.alloc(4000001)));
  assert.equal(validateSubmission({...f,retryOf:randomUUID()},pdf).requestHash,input.requestHash);
});
test('context and encrypted metadata bind owner, session, environment, connection and identity',()=>{
  const c=config(),r=row();c.accountId=r.account_id;const context=contextFor(r,'session-a',c);
  checkContext(r,r.user_id,'session-a',context,c);
  for(const change of [{user_id:randomUUID()},{id:randomUUID()},{generation:'6'},{extension_id:'555'},{environment:'production'},{state:'disconnected'}])assert.throws(()=>checkContext({...r,...change},r.user_id,'session-a',context,c));
  assert.throws(()=>checkContext(r,r.user_id,'session-b',context,c));
  const attempt={...r,connection_id:r.id,id:randomUUID()},envelope=encrypt(fields(),metadataContext(attempt),c);
  assert(!JSON.stringify(envelope).includes('0012'));assert.throws(()=>decrypt(envelope,metadataContext({...attempt,user_id:randomUUID()}),c));assert.throws(()=>decrypt(envelope,metadataContext({...attempt,id:randomUUID()}),c));
});
test('strict multipart input rejects duplicate fields and non-PDFs',async()=>{
  const make=async duplicate=>{const form=new FormData();for(const [key,value]of Object.entries(fields()))if(key!=='filename')form.append(key,String(value));form.append('file',file());if(duplicate)form.append('lastFour','1234');const r=new Request('http://localhost',{method:'POST',body:form});const req=Readable.from(Buffer.from(await r.arrayBuffer()));req.headers=Object.fromEntries(r.headers);return req;};
  assert.equal((await upload(await make(false))).metadata.lastFour,'0012');await assert.rejects(upload(await make(true)));
});
test('provider sends exactly one PDF with Classic metadata and no Last 4 or source filename',async()=>{
  let calls=0;const provider=new FaxProvider(async(url,options)=>{calls++;assert(url.endsWith('/account/827653020/extension/12345/fax'));assert.equal(options.redirect,'error');assert.equal(options.method,'POST');assert.equal(options.body.getAll('attachment').length,1);assert.equal(options.body.get('attachment').name,'document.pdf');const data=await options.body.get('json').text();assert(!data.includes('0012'));assert(!data.includes('Brief'));assert.equal(JSON.parse(data).coverIndex,5);return response({id:'123456',messageStatus:'Queued'});});
  assert.deepEqual(await provider.send(row(),'synthetic-token',validateSubmission(fields(),pdf)),{messageId:'123456',status:'Queued'});assert.equal(calls,1);
});
test('receipt validates owned outbound Sent message and member PDF; provider URL is never followed',async()=>{
  const r={...row(),message_id:'123456'};let paths=[];
  const base={id:r.message_id,type:'Fax',direction:'Outbound',messageStatus:'Sent',attachments:[{id:'777',type:'RenderedDocument',contentType:'application/pdf',uri:'https://evil.invalid/credential-exfiltration'}]};
  let message=base;
  const provider=new FaxProvider(async(url,options)=>{paths.push(url);assert.equal(options.redirect,'error');if(url.endsWith('/content/777'))return new Response(pdf,{headers:{'Content-Type':'application/pdf'}});return response(message);});
  assert.deepEqual(await provider.receipt(r,'synthetic-token'),pdf);assert(paths.every(p=>p.startsWith('https://platform.ringcentral.com/restapi/')));
  for(const changed of [{id:'999'},{type:'SMS'},{direction:'Inbound'},{messageStatus:'Queued'},{attachments:[]},{attachments:[{id:'777',type:'OriginalDocument',contentType:'application/pdf'}]}]){message={...base,...changed};paths=[];await assert.rejects(provider.receipt(r,'synthetic-token'));assert.equal(paths.length,1);}
  assert.equal(safeStatus('Delivered'),'Unknown');
});
test('receipt rejects non-PDF bodies, partial responses, wrong MIME and oversized content',async()=>{
  const r={...row(),message_id:'123456'};
  const message={id:r.message_id,type:'Fax',direction:'Outbound',messageStatus:'Sent',attachments:[{id:'777',type:'RenderedDocument',contentType:'application/pdf'}]};
  for(const mode of ['body','mime','partial','size']) {
    const provider=new FaxProvider(async url=>url.endsWith('/content/777')?new Response(mode==='size'?Buffer.alloc(10*1024*1024+1):mode==='body'?'private provider text':pdf,{status:mode==='partial'?206:200,headers:{'Content-Type':mode==='mime'?'text/html':'application/pdf'}}):response(message));
    await assert.rejects(provider.receipt(r,'synthetic'));
  }
});
test('contacts use explicit employee extension, fax-only projection, deduplication and create preflight',async()=>{
  const r=row(),paths=[];let posts=0;
  const provider=new FaxProvider(async(path,options)=>{paths.push(path);if(options.method==='POST'){posts++;const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),['businessFax','firstName']);return response({id:'444'});}return response({records:[{id:'111',firstName:'A',businessFax:'+18015551234',otherFax:'+18015551234',email:'private@example.invalid',notes:'private'},{id:'222',firstName:'B',otherFax:'+442079460000'}],paging:{page:1,totalPages:1}});});
  const list=await provider.contacts(r,'synthetic');assert.equal(list.length,2);assert.equal(list[0].numbers.length,1);assert(!JSON.stringify(list).includes('private'));
  await provider.createContact(r,'synthetic',{name:'A',faxNumber:'+18015551234'});assert.equal(posts,0);
  await provider.createContact(r,'synthetic',{name:'New',faxNumber:'+442079460001'});assert.equal(posts,1);assert(paths.every(p=>p.includes('/extension/12345/address-book/contact')));
});
test('empty address book and formatted fax fields retain v2-compatible contact behavior',async()=>{
  const empty=new FaxProvider(async()=>response({records:[],paging:{page:1,totalPages:0}}));assert.deepEqual(await empty.contacts(row(),'synthetic'),[]);
  const formatted=new FaxProvider(async()=>response({records:[{id:'1',nickName:'Nickname',businessFax:'+1 (801) 555-1234',otherFax:'+18015551234'}]}));assert.deepEqual((await formatted.contacts(row(),'synthetic'))[0].numbers,['+18015551234']);
});
test('every operational handler requires Toolkit session, context and Development; rejects CSRF before provider',async()=>{
  for(const action of ['context','contacts','send','status','message','receipt','history']) {
    const c=config();let work=0;
    const deps={config:c,authConfig:{origin:c.origin,sessionCookie:'toolkit_session'},requireUser:async()=>{throw Object.assign(Error(),{status:401});},store:{locked:async()=>{work++;throw Object.assign(Error(),{status:409});}},service:new Proxy({},{get:()=>async()=>{work++;return {};}})};
    const run=async(overrides={},headers={})=>{const req={method:action==='send'?'POST':'GET',url:'/api/fax-v3/'+action,headers};const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;}};await createFaxHandler(action,{...deps,...overrides})(req,res);return res;};
    assert.equal((await run()).code,401);assert.equal(work,0);
    assert.equal((await run({requireUser:async()=>({id:randomUUID()})})).code,401);
    const headers={cookie:'toolkit_session='+'a'.repeat(43),origin:c.origin};
    const result=await run({requireUser:async()=>({id:randomUUID()})},headers);assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.code,action==='context'?200:409);
    assert.equal((await run({config:{...c,environment:'production'}})).code,404);
  }
});
test('batch validates Last 4 before submission; snapshot, sequential spacing and one PDF per call',async()=>{
  const inputs=[],delays=[];const scope=new Scope(contextual(async(_path,options)=>{const f=options.body;inputs.push(Object.fromEntries([...f].filter(([k])=>k!=='file')));assert.equal(f.getAll('file').length,1);return response({faxId:randomUUID(),status:'Queued',retryable:false});}));scope.set('c');
  const batch=new Batch(scope,()=>{},async ms=>delays.push(ms));await batch.add([file(),new File([pdf],'Second.pdf',{type:'application/pdf'})]);
  await assert.rejects(batch.run({...settings(),lastFour:'123'}));assert.equal(inputs.length,0);
  const s=settings();const run=batch.run(s);s.lastFour='9999';s.faxNumber='+442079460000';await run;
  assert.equal(inputs.length,2);assert.deepEqual(delays,[1000]);assert(inputs.every(i=>i.lastFour==='0012'&&i.faxNumber==='+18015551234'));await batch.run(settings());assert.equal(inputs.length,2);
});
test('ambiguity halts queue; only definitive failure allows explicit retry',async()=>{
  let calls=0;const scope=new Scope(async()=>{calls++;throw Error('synthetic lost acknowledgement');});scope.set('c');const batch=new Batch(scope,()=>{},async()=>{});await batch.add([file(),new File([pdf],'Second.pdf',{type:'application/pdf'})]);await batch.run(settings());assert.equal(calls,1);assert.equal(batch.documents[0].state,'Unknown');await batch.run(settings(),true);assert.equal(calls,1);
});
test('logout/generation change during in-flight batch discards response and cancels remaining queue',async()=>{
  let complete,calls=0;let batch;const scope=new Scope(()=>{calls++;return new Promise(r=>complete=r);},()=>batch?.clear());scope.set('old');batch=new Batch(scope,()=>{},async()=>{});await batch.add([file(),new File([pdf],'Second.pdf',{type:'application/pdf'})]);const pending=batch.run(settings());scope.set('new');complete(response({faxId:randomUUID(),status:'Sent'}));await pending;assert.equal(calls,1);assert.equal(batch.documents.length,0);
});
test('response publication rechecks current browser session, including changes without an event',async()=>{
  let reset=0;const scope=new Scope(async path=>path.endsWith('/context')?response({state:'connected',context:'different-employee'}):response({contacts:[{name:'Employee A private contact'}]}),()=>reset++);scope.set('c');
  await assert.rejects(scope.api('contacts'));assert.equal(scope.context,null);assert.equal(reset,2);
});
test('polling keeps 10s initial, 30s interval, 5s spacing, 15m deadline; stale results ignored',async()=>{
  let now=Date.now(),calls=0,updated=0,complete;const scope=new Scope(()=>{calls++;return new Promise(r=>complete=r);});scope.set('old');const poller=new Poller(scope,()=>updated++,()=>now);const entry={faxId:randomUUID(),tracking:true,createdAt:new Date(now).toISOString()};poller.track(entry);await poller.tick();assert.equal(calls,0);now+=10000;const pending=poller.tick();scope.reset();poller.clear();complete(response({...entry,status:'Sent',tracking:false}));await pending;assert.equal(updated,0);assert.equal(calls,1);
});
test('polling intervals and terminal/expired rules prevent aggressive or indefinite lookup',async()=>{
  let now=Date.now(),calls=0;const entry={faxId:randomUUID(),tracking:true,status:'Queued',createdAt:new Date(now).toISOString()};
  const scope=new Scope(contextual(async()=>{calls++;return response(entry);}));scope.set('c');const poller=new Poller(scope,()=>{},()=>now);poller.track(entry);
  now+=10000;await poller.tick();assert.equal(calls,1);now+=29999;await poller.tick();assert.equal(calls,1);now++;await poller.tick();assert.equal(calls,2);
  now=new Date(entry.createdAt).getTime()+900001;await poller.tick();assert.equal(calls,2);assert.equal(poller.pending.size,0);
});
test('legacy history is untouched; v3 never reads and no client persistence; safe filenames and valid duplicate-name ZIP',async()=>{
  for(const name of ['Brief - SSA.pdf','bad<>:"/\\|?*.pdf','double.pdf.pdf'])assert.equal(browserFilename(name,'0012'),receiptFilename(name,'0012'));
  const filename=browserFilename('Brief.pdf','0012');assert.equal(filename,'Fax Receipt - Brief 0012.pdf');const blob=new Blob([pdf]);const zip=await receiptZip([{filename,blob},{filename,blob}]);const files=unzipSync(new Uint8Array(await zip.arrayBuffer()));assert.equal(Object.keys(files).length,2);assert.deepEqual(Buffer.from(files[filename]),pdf);
  for(const file of ['app.js','client.js','test.js']){const source=await readFile(new URL('../development/fax-sender-v3/'+file,import.meta.url),'utf8');assert(!/localStorage|sessionStorage|RC_USER_JWT|accessToken|refreshToken|clientSecret/.test(source));}
  assert.equal(number('(801) 555-1234'),'+18015551234');assert.equal(number('+44 20 7946 0000'),'+442079460000');
});
test('migration 003 refuses Production before opening pool',async()=>{
  let opened=0;const args=['--apply','--development'];const result=await migrateFax({args,env:{VERCEL_ENV:'production'},openPool:()=>{opened++;},readSql:async()=>'',log:()=>assert.fail(),error:()=>{}});assert.equal(result,1);assert.equal(opened,0);
});
test('migration 003 verifies prerequisite/checksums, rolls back failure and logs only after COMMIT',async()=>{
  const env={TOOLKIT_ORIGIN:'http://localhost:5173',DATABASE_URL:'postgres://test:test@ep-synthetic-dev.us-east-1.aws.neon.tech/test'};
  const digest=s=>createHash('sha256').update(s).digest('hex');
  for(const mode of ['apply','already','wrong-prerequisite','wrong-checksum','commit-lost']) {
    const events=[];const client={release(){},async query(sql,args){events.push(sql);
      if(sql.startsWith('SELECT checksum'))return {rows:args[0]==='002_ringcentral_v3'?[{checksum:mode==='wrong-prerequisite'?'bad':digest('002_ringcentral_v3')}]:mode==='already'?[{checksum:digest('003_fax_v3_operations')}]:mode==='wrong-checksum'?[{checksum:'bad'}]:[]};
      if(sql==='COMMIT'&&mode==='commit-lost')throw Error();return {rows:[]};}};
    const result=await migrateFax({args:['--apply','--development'],env,readSql:async name=>name,openPool:async()=>({connect:async()=>client,end:async()=>{}}),log:()=>events.push('SUCCESS'),error:()=>events.push('FAIL')});
    assert.equal(result,['apply','already'].includes(mode)?0:1);
    if(result===0)assert(events.indexOf('SUCCESS')>events.indexOf('COMMIT'));else {assert(!events.includes('SUCCESS'));assert(events.includes('ROLLBACK'));}
  }
});
