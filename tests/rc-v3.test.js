import test from 'node:test';
import assert from 'node:assert/strict';
import { rcConfig } from '../server/ringcentral-v3/config.js';
import { encrypt,decrypt,tokenContext } from '../server/ringcentral-v3/crypto.js';
import { RingCentralProvider } from '../server/ringcentral-v3/provider.js';
import { RcService } from '../server/ringcentral-v3/service.js';
import { createRcHandler } from '../server/ringcentral-v3/handler.js';
import { challenge,randomToken } from '../server/auth/security.js';
import { env,config,token,identity } from './rc-v3-fixtures.js';
import { assertDevelopment } from '../scripts/rc-v3-development-guard.mjs';
import { runRcMigration } from '../scripts/migrate-rc-v3.mjs';
import { readFile } from 'node:fs/promises';
const context=['tokens','development','user-a','connection-a','827653020','12345'];

test('RC configuration fails closed for Preview, origin, missing values and invalid encryption keys',()=>{
  assert.equal(config().environment,'development');
  for(const patch of [{VERCEL_ENV:'preview'},{VERCEL_ENV:'production'},{TOOLKIT_ORIGIN:'http://evil.invalid'},
    {RC_ALLOWED_ACCOUNT_ID:'~'},{RC_TOKEN_ENCRYPTION_ACTIVE_KEY_ID:'v2'},{RC_TOKEN_ENCRYPTION_KEY_V1:'invalid'},
    {RC_OAUTH_CLIENT_SECRET:''},{RC_OAUTH_CLIENT_ID:''},{RC_TOKEN_ENCRYPTION_KEY_V1:Buffer.alloc(16).toString('base64')}])assert.throws(()=>rcConfig({...env(),...patch}));
  assert.equal(rcConfig({...env(),VERCEL_ENV:'production',TOOLKIT_ORIGIN:'https://packardtoolkit.vercel.app'}).secure,true);
});
test('AES-GCM binds every context field; tamper, wrong key, unknown version and key fail closed',()=>{
  const c=config(),value={accessToken:'secret-a',refreshToken:'secret-b'};
  const encrypted=encrypt(value,context,c);
  assert.deepEqual(decrypt(encrypted,context,c),value);
  assert(!JSON.stringify(encrypted).includes('secret-'));
  assert.notDeepEqual(encrypt(value,context,c),encrypted);
  for(let i=0;i<context.length;i++){const wrong=[...context];wrong[i]+='-wrong';assert.throws(()=>decrypt(encrypted,wrong,c));}
  for(const field of ['iv','tag','data'])assert.throws(()=>decrypt({...encrypted,[field]:Buffer.alloc(field==='iv'?12:16).toString('base64')},context,c));
  assert.throws(()=>decrypt({...encrypted,v:2},context,c));assert.throws(()=>decrypt({...encrypted,kid:'v9'},context,c));
  assert.throws(()=>decrypt(encrypted,context,rcConfig({...env(),RC_TOKEN_ENCRYPTION_KEY_V1:Buffer.alloc(32,8).toString('base64')})));
});
test('key rotation reads old key and writes active key without accepting missing old key',()=>{
  const before=encrypt({refreshToken:'test'},context,config());
  const e={...env(),RC_TOKEN_ENCRYPTION_KEY_V2:Buffer.alloc(32,9).toString('base64'),RC_TOKEN_ENCRYPTION_ACTIVE_KEY_ID:'v2'};
  const c=rcConfig(e);const next=encrypt(decrypt(before,context,c),context,c);assert.equal(next.kid,'v2');
  delete e.RC_TOKEN_ENCRYPTION_KEY_V1;assert.throws(()=>decrypt(before,context,rcConfig(e)));assert.equal(decrypt(next,context,rcConfig(e)).refreshToken,'test');
});
test('PKCE S256 and confidential exchange stay server side; provider responses are allowlisted',async()=>{
  let calls=[];const c=config();
  const p=new RingCentralProvider(c,async(url,options)=>{calls.push({url,options});return Response.json({access_token:'access',refresh_token:'refresh',token_type:'bearer',expires_in:3600,refresh_token_expires_in:86400,scope:'Contacts Faxes ReadAccounts ReadMessages',owner_id:'12345',unsafe:'discard'});});
  const verifier=randomToken(),state=randomToken(),url=new URL(p.authorizationUrl(state,challenge(verifier)));
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('code_challenge'),challenge(verifier));assert(!url.href.includes(verifier));assert(!url.href.includes(c.clientSecret));
  const result=await p.exchange('code',verifier);assert.equal(calls[0].options.body.get('code_verifier'),verifier);assert.equal(calls[0].options.body.get('redirect_uri'),c.redirectUri);assert.equal(calls[0].options.redirect,'error');assert.equal(result.unsafe,undefined);
  await p.refresh('refresh');assert.equal(calls[1].options.body.get('grant_type'),'refresh_token');
  assert(!calls.some(x=>x.options.body.has('assertion')));
});
test('provider verifies allowed account and exact extension identity, refuses injected media origins and disabled extensions',async()=>{
  const run=async(patch={})=>{
    const p=new RingCentralProvider(config(),async url=>Response.json(url.endsWith('/extension/~')?
      {id:'12345',uri:'https://platform.ringcentral.com/restapi/v1.0/account/827653020/extension/12345',status:'Enabled',type:'User',name:'Employee',...patch}:
      {id:'827653020',uri:'https://platform.ringcentral.com/restapi/v1.0/account/827653020'}));
    return p.identity(token());
  };
  assert.equal((await run()).extensionId,'12345');
  for(const patch of [{id:'54321'},{status:'Disabled'},{type:'VirtualUser'},{uri:'https://evil.invalid/restapi/v1.0/account/827653020/extension/12345'}])await assert.rejects(run(patch));
  const p=new RingCentralProvider(config(),async()=>Response.json({id:'999',uri:'https://platform.ringcentral.com/restapi/v1.0/account/999'}));await assert.rejects(p.identity(token()));
});
test('provider does not forward upstream diagnostics or accept incomplete tokens/scopes',async()=>{
  for(const response of [()=>new Response('private-upstream-secret',{status:500}),()=>Response.json({access_token:'private-upstream-secret'})]){
    const p=new RingCentralProvider(config(),async()=>response());await assert.rejects(p.exchange('code','verifier'),e=>!e.message.includes('private-upstream-secret'));
  }
});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(v){this.code=v;return this},json(v){this.body=v;return this},end(){return this}};}
test('handlers require Toolkit auth, same-origin mutation, safe response and no token exposure',async()=>{
  const c=config(),session=randomToken(),req={method:'POST',headers:{cookie:'toolkit_session='+session,origin:c.origin,'sec-fetch-site':'same-origin'}};
  const deps={config:c,authConfig:{origin:c.origin,sessionCookie:'toolkit_session'},requireUser:async()=>({id:'user'}),service:{connect:async()=>{throw Error('private-credential')},status:async()=>({state:'disconnected'})}};
  let res=response();await createRcHandler('connect',deps)(req,res);assert.equal(res.code,503);assert(!JSON.stringify(res).includes('private-credential'));assert.equal(res.headers['Cache-Control'],'no-store');
  res=response();await createRcHandler('connect',deps)({...req,headers:{...req.headers,origin:'https://evil.invalid'}},res);assert.equal(res.code,403);
  res=response();await createRcHandler('connection',{...deps,requireUser:async()=>{throw Object.assign(Error('secret'),{status:401})}})({...req,method:'GET'},res);assert.equal(res.code,401);
  res=response();await createRcHandler('connection',deps)({...req,method:'GET'},res);assert.deepEqual(res.body,{state:'disconnected'});
  res=response();await createRcHandler('connect',deps)({...req,method:'GET'},res);assert.equal(res.code,405);
});
test('callback rejects duplicate parameters, missing browser/session binding and wrong origin before exchange',async()=>{
  let calls=0;const c=config(),s=randomToken(),state=randomToken(),b=randomToken();
  const deps={config:c,authConfig:{origin:c.origin,sessionCookie:'toolkit_session'},requireUser:async()=>({id:'user'}),service:{callback:async()=>{calls++}}};
  for(const url of [`/api/ringcentral/callback?state=${state}&state=${state}&code=x`,`/api/ringcentral/callback?state=${state}&code=x&code=y`,`https://evil.invalid/api/ringcentral/callback?state=${state}&code=x`,`/api/ringcentral/callback?state=${state}&error=denied`]){
    await createRcHandler('callback',deps)({method:'GET',url,headers:{cookie:`toolkit_session=${s}; toolkit_rc_binding=${b}`}},response());
  }
  await createRcHandler('callback',deps)({method:'GET',url:`/api/ringcentral/callback?state=${state}&code=x`,headers:{cookie:`toolkit_session=${s}`}},response());
  assert.equal(calls,0);
});
test('refresh uncertainty never retries and stale completion never returns tokens',async()=>{
  const c=config(),row={id:'connection',user_id:'user',environment:'development',account_id:identity.accountId,extension_id:identity.extensionId,state:'connected',generation:'1',access_expires_at:new Date(0),refresh_expires_at:new Date(Date.now()+999999)};
  row.token_envelope=encrypt({accessToken:'old',refreshToken:'old-refresh'},tokenContext(row),c);
  for(const outcome of ['timeout','stale']){
    let refreshes=0,uncertain=0,revoked=0;
    const store={get:async()=>row,claim:async()=>row,refreshed:async()=>false,uncertain:async()=>uncertain++};
    const p={refresh:async()=>{refreshes++;if(outcome==='timeout')throw Error('private');return token()},revoke:async()=>revoked++};
    await assert.rejects(new RcService(c,store,p).accessToken('user'));
    assert.equal(refreshes,1);assert.equal(uncertain,1);assert.equal(revoked,outcome==='stale'?1:0);
  }
});
test('Development guard rejects main endpoint, Preview and Production before opening DB',async()=>{
  const good={TOOLKIT_ORIGIN:'http://localhost:5173',DATABASE_URL:'postgresql://test:test@ep-synthetic-dev.us-east-1.aws.neon.tech/test?sslmode=require'};
  assert.doesNotThrow(()=>assertDevelopment(good));
  for(const e of [{...good,VERCEL_ENV:'preview'},{...good,VERCEL_ENV:'production'},{...good,DATABASE_URL:'postgresql://test:test@ep-young-dream-arkoh9e5-pooler.us-east-1.aws.neon.tech/test?sslmode=require'}]){
    assert.throws(()=>assertDevelopment(e));let opened=false;
    assert.equal(await runRcMigration({args:['--apply','--development'],env:e,openPool:async()=>{opened=true},readSql:async()=>'',log:()=>{},error:()=>{}}),1);assert.equal(opened,false);
  }
});
test('migration success is emitted only after COMMIT succeeds',async()=>{
  const e={TOOLKIT_ORIGIN:'http://localhost:5173',DATABASE_URL:'postgres://test:test@ep-synthetic-dev.us-east-1.aws.neon.tech/test'};
  for(const fail of [false,true]){
    let committed=false,logs=0;
    const client={release(){},async query(sql,params){if(sql==='COMMIT'){if(fail)throw Error('private');committed=true}return {rows:params?.[0]==='001_toolkit_auth'?[{checksum:'d25c789f9fe3840a3f061f40dddc02578df2f1e0b91f4ed07f9508bac8f0b605'}]:[]}}};
    const result=await runRcMigration({args:['--apply','--development'],env:e,openPool:async()=>({connect:async()=>client,end:async()=>{}}),readSql:async()=>'',log:()=>{assert(committed);logs++},error:()=>{}});
    assert.equal(result,fail?1:0);assert.equal(logs,fail?0:1);
  }
});
test('Isolation: v2 sources and browser bundles never import new credentials or backend',async()=>{
  const root=new URL('../',import.meta.url);
  for(const path of ['package.json','fax-sender/main.js','fax-sender/batch.js','fax-sender/history.js','settings/shared/app-shell.js']){
    const source=await readFile(new URL(path,root),'utf8');
    assert(!/ringcentral-v3|RC_OAUTH_|RC_TOKEN_ENCRYPTION|migrate-rc-v3|fax-sender-v3/.test(source));
  }
  for(const path of ['config','crypto','provider','store','service','handler']){
    const source=await readFile(new URL(`server/ringcentral-v3/${path}.js`,root),'utf8');
    assert(!/console\.|localStorage|sessionStorage|RC_USER_JWT|jwt-bearer/.test(source));
  }
});
test('migration refuses existing checksum mismatch and missing foundation, and supports matching no-op',async()=>{
  const {createHash}=await import('node:crypto');
  const env={TOOLKIT_ORIGIN:'http://localhost:5173',DATABASE_URL:'postgres://test:test@ep-synthetic-dev.us-east-1.aws.neon.tech/test'};
  for(const mode of ['mismatch','missing','matching']){
    const queries=[],messages=[];
    const client={release(){},async query(sql,params){queries.push(sql);if(params?.[0]==='001_toolkit_auth')return {rows:mode==='missing'?[]:[{checksum:'d25c789f9fe3840a3f061f40dddc02578df2f1e0b91f4ed07f9508bac8f0b605'}]};
      if(params?.[0]==='002_ringcentral_v3')return {rows:[{checksum:mode==='matching'?createHash('sha256').update('SELECT 1').digest('hex'):'wrong'}]};return {rows:[]}}};
    const result=await runRcMigration({args:['--apply','--development'],env,openPool:async()=>({connect:async()=>client,end:async()=>{}}),readSql:async()=>'SELECT 1',log:v=>messages.push(v),error:()=>{}});
    assert.equal(result,mode==='matching'?0:1);assert(!queries.includes('SELECT 1'));assert.equal(messages.length,mode==='matching'?1:0);
  }
});
test('opt-in Development harness serves only authenticated RC routes and preserves Entra signed-out behavior',async()=>{
  const {createServer}=await import('vite');
  // Existing Entra handler constructs a lazy pool even for signed-out requests;
  // a synthetic URL satisfies configuration without a database connection.
  const overrides={DATABASE_URL:'postgresql://synthetic:synthetic@localhost:1/synthetic',ENTRA_TENANT_ID:'11111111-1111-4111-8111-111111111111',ENTRA_CLIENT_ID:'22222222-2222-4222-8222-222222222222',ENTRA_CLIENT_SECRET:'synthetic-only',TOOLKIT_ORIGIN:'http://localhost:5173'};
  const before=Object.fromEntries(Object.keys(overrides).map(k=>[k,process.env[k]]));Object.assign(process.env,overrides);
  let server;
  try{
    server=await createServer({configFile:new URL('../vite.rc-v3.config.js',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),envDir:false,logLevel:'silent',server:{host:'127.0.0.1',port:0,strictPort:false}});
    await server.listen();const base='http://127.0.0.1:'+server.httpServer.address().port;
    const page=await fetch(base+'/fax-sender-v3/');assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');assert.equal(page.headers.get('referrer-policy'),'same-origin');assert.match(await page.text(),/Connect RingCentral/);
    const script=await fetch(base+'/fax-sender-v3/test.js');assert.equal(script.status,200);assert.match(await script.text(),/clearIdentity/);
    for(const [route,method] of [['connection','GET'],['connect','POST'],['callback','GET'],['disconnect','POST']]){
      const r=await fetch(base+'/api/ringcentral/'+route,{method,redirect:'manual'});assert.equal(r.status,401,route);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),{error:'Toolkit sign-in required'});
    }
    const r=await fetch(base+'/api/auth/session');assert.equal(r.status,401);assert.equal((await r.json()).authenticated,false);
  }finally{await server?.close();for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v}}
});
test('connection status exposes verified identity fields only, never token envelopes',async()=>{
  const service=new RcService(config(),{get:async()=>({state:'connected',display_name:'Employee',account_id:'827653020',extension_id:'12345',token_envelope:'private-canary',refresh_claim:'private-canary'})},{});
  assert.deepEqual(await service.status('user'),{state:'connected',displayName:'Employee',accountId:'827653020',extensionId:'12345'});
});
test('only opt-in Development callback returns to test page; errors use a fixed flag',async()=>{
  const state=randomToken(),binding=randomToken(),session=randomToken();
  for(const production of [false,true])for(const failure of [false,true]){
    const c=production?rcConfig({...env(),VERCEL_ENV:'production',TOOLKIT_ORIGIN:'https://packardtoolkit.vercel.app'}):config();
    const deps={developmentTestPage:true,config:c,authConfig:{origin:c.origin,sessionCookie:'toolkit_session'},requireUser:async()=>({id:'user'}),service:{callback:async()=>{if(failure)throw Error('private-canary')}}};
    const res=response();await createRcHandler('callback',deps)({method:'GET',url:`/api/ringcentral/callback?state=${state}&code=private-code`,headers:{cookie:`toolkit_session=${session}; ${c.bindingCookie}=${binding}`}},res);
    assert(!JSON.stringify(res).includes('private-'));
    if(!production){assert.equal(res.code,303);assert.equal(res.headers.Location,c.origin+'/fax-sender-v3/?connection='+(failure?'failed':'connected'));}
    else if(!failure)assert.equal(res.headers.Location,c.origin+'/api/ringcentral/connection');
    else assert.equal(res.code,503);
  }
});
