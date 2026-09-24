import test from 'node:test';
import assert from 'node:assert/strict';
import {v3Runtime} from '../server/ringcentral-v3/runtime.js';
import {env} from './rc-v3-fixtures.js';
import {createRcHandler} from '../server/ringcentral-v3/handler.js';
import {createFaxHandler} from '../server/fax-v3/handler.js';
import {randomToken} from '../server/auth/security.js';
const development=()=>({...env(),DATABASE_URL:'postgresql://synthetic:synthetic@ep-test-branch.us-east-1.aws.neon.tech/test?sslmode=require'});
const production=()=>({...development(),VERCEL:'1',VERCEL_ENV:'production',TOOLKIT_ORIGIN:'https://packardtoolkit.vercel.app',FAX_V3_PRODUCTION_ACCEPTANCE:'enabled',DATABASE_URL:'postgresql://synthetic:synthetic@ep-young-dream-arkoh9e5-pooler.us-east-1.aws.neon.tech/test?sslmode=require'});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;},end(){}});
test('production acceptance requires exact environment, origin, database, account and complete keys',()=>{
  assert.equal(v3Runtime(development()).environment,'development');assert.equal(v3Runtime(production()).productionAcceptance,true);
  for(const patch of [{FAX_V3_PRODUCTION_ACCEPTANCE:undefined},{FAX_V3_PRODUCTION_ACCEPTANCE:'true'},{VERCEL_ENV:'preview'},{VERCEL:undefined},{TOOLKIT_ORIGIN:'https://evil.invalid'},{DATABASE_URL:development().DATABASE_URL},{DATABASE_URL:''},{RC_ALLOWED_ACCOUNT_ID:'999'},{RC_TOKEN_ENCRYPTION_KEY_V1:''},{RC_TOKEN_ENCRYPTION_ACTIVE_KEY_ID:'v2'},{RC_OAUTH_CLIENT_SECRET:''}])assert.throws(()=>v3Runtime({...production(),...patch}));
  assert.throws(()=>v3Runtime({...development(),DATABASE_URL:production().DATABASE_URL}));
});
test('enabled production callback returns to fixed candidate page, never a request return URL',async()=>{
  const c=v3Runtime(production()),state=randomToken(),binding=randomToken(),session=randomToken();
  for(const failed of [false,true]){
    const res=response();await createRcHandler('callback',{config:c,authConfig:{origin:c.origin,sessionCookie:'__Host-toolkit_session'},requireUser:async()=>({id:'synthetic'}),service:{callback:async()=>{if(failed)throw Error('private-canary');}}})({method:'GET',url:'/api/ringcentral/callback?state='+state+'&code=synthetic&returnTo=https://evil.invalid',headers:{cookie:'__Host-toolkit_session='+session+'; '+c.bindingCookie+'='+binding}},res);
    assert.equal(res.code,303);assert.equal(res.headers.Location,c.origin+'/fax-sender-v3/?connection='+(failed?'failed':'connected'));assert.match(res.headers['Set-Cookie'],/Secure/);assert(!JSON.stringify(res).includes('private-canary'));
  }
});
test('production operations still require session and ownership context before provider calls',async()=>{
  const c=v3Runtime(production());for(const action of ['context','contacts','history','send','status','message','receipt']){
    let work=0;const service=new Proxy({},{get:()=>async()=>{work++;}});const req={method:action==='send'?'POST':'GET',url:'/api/fax-v3/'+action,headers:{}};
    const res=response();await createFaxHandler(action,{config:c,authConfig:{origin:c.origin,sessionCookie:'__Host-toolkit_session'},requireUser:async()=>{throw Object.assign(Error(),{status:401});},service})(req,res);assert.equal(res.code,401);assert.equal(work,0);
    if(action==='context')continue;
    const forbidden=response();await createFaxHandler(action,{config:c,authConfig:{origin:c.origin,sessionCookie:'__Host-toolkit_session'},requireUser:async()=>({id:'a'}),store:{locked:async()=>{throw Object.assign(Error(),{status:409});}},service})({...req,headers:{origin:c.origin,cookie:'__Host-toolkit_session='+randomToken()}},forbidden);assert.equal(forbidden.code,409);assert.equal(work,0);
  }
});
