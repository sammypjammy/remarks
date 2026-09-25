import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as nodeModule from 'node:module';
import {callbackDecision,authFailure,AUTH_FAILURES} from '../maintenance/fax-v3-production/neon-auth-listener.mjs';
import {cliEnvironment,CLI_VERSION,PROFILE} from '../maintenance/fax-v3-production/neon-cli.mjs';

test('callback filter rejects probes, wrong state/host/method, duplicate parameters and concurrent callbacks',()=>{
 const valid={method:'GET',host:'127.0.0.1:54321',url:'/callback?state=synthetic-state&code=synthetic-code',port:54321,state:'synthetic-state'};
 assert.equal(callbackDecision(valid),'ACCEPT');
 for(const change of [{method:'POST'},{method:'OPTIONS'},{host:'wrong.invalid'},{url:'/callback'},{url:'/callback?code=synthetic-code'},{url:'/callback?state=wrong&code=synthetic-code'},{url:'/callback?state=synthetic-state'},{url:valid.url+'&state=synthetic-state'},{url:valid.url+'&code=extra'},{url:valid.url+'&error=access_denied'},{url:valid.url+'#fragment'},{url:'http://wrong.invalid'+valid.url},{url:'/callback/extra?state=synthetic-state&code=synthetic-code'},{url:'/callback?state=synthetic-state&code='},{pending:true},{state:undefined},{url:'x'.repeat(16385)}])assert.equal(callbackDecision({...valid,...change}),'IGNORE');
 assert.equal(callbackDecision({...valid,url:'/callback?state=synthetic-state&error=access_denied'}),'DENIED');
});

for(const scenario of ['early-probe','token-error'])test(`private process helper retains listener and emits only fixed diagnostics: ${scenario}`,{skip:typeof nodeModule.registerHooks!=='function'||process.platform!=='win32'},async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'fax-neon-helper-'));
 try{
  const result=spawnSync(process.execPath,['tests/neon-helper-fixture.mjs',fixture,scenario],{env:cliEnvironment(process.env),encoding:'utf8',timeout:12000,windowsHide:true});
  const lines=result.stdout.trim().split(/\r?\n/);
  assert.equal(result.status,scenario==='early-probe'?0:1);
  assert.equal(result.stderr,'');
  assert(lines.includes('NEON_CLI_CALLBACK_LISTENING_60_SECOND_WINDOW'));
  assert(lines.includes('NEON_CLI_CALLBACK_RECEIVED'));
  assert.equal(lines.at(-1),scenario==='early-probe'?'FIXTURE_HELPER_AUTH_COMPLETED':'NEON_CLI_AUTH_TOKEN_EXCHANGE_FAILED');
  assert(lines.every(line=>/^(?:NEON_CLI_|FIXTURE_)[A-Z0-9_]+$/.test(line)));
  assert(!/synthetic-|https?:|Auth Url:|code=|access_token|refresh_token/.test(result.stdout));
 }finally{await rm(fixture,{recursive:true,force:true});}
});

test('authentication diagnostics have only fixed categories and never echo upstream content',()=>{
 for(const text of ['synthetic-secret-canary','Authentication timed out after 60 seconds','Failed to open web browser','Failed to save credentials','This CLI cannot use the OS keyring','NEON_REQUEST_REFUSED','Could not reach the Neon API']){
  const result=authFailure(text);assert(AUTH_FAILURES.includes(result));assert(!result.includes('canary'));
 }
});

const scenarios=[['normal',0,'NEON_CLI_AUTH_CREDENTIALS_SAVED'],['early-probe',0,'NEON_CLI_AUTH_CREDENTIALS_SAVED'],['denied',1,'NEON_CLI_AUTH_CALLBACK_REJECTED'],['token-error',1,'NEON_CLI_AUTH_TOKEN_EXCHANGE_FAILED'],['timeout',1,'NEON_CLI_AUTH_TIMEOUT'],['listener-error',1,'NEON_CLI_AUTH_LISTENER_FAILED']];
for(const [scenario,exit,expected]of scenarios)test(`official CLI callback lifecycle offline: ${scenario}`,{skip:typeof nodeModule.registerHooks!=='function'||process.platform!=='win32'},async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'fax-neon-callback-'));
 try{
  const pkg=JSON.parse(await readFile(new URL('../maintenance/fax-v3-production/node_modules/neon/package.json',import.meta.url),'utf8'));assert.equal(pkg.version,CLI_VERSION);
  const result=spawnSync(process.execPath,['--import','./tests/neon-auth-fixture.mjs','maintenance/fax-v3-production/neon-process.mjs','auth',fixture],{
   env:{...cliEnvironment(process.env,true),FAX_NEON_FIXTURE_SCENARIO:scenario},encoding:'utf8',timeout:12000,windowsHide:true
  });
  assert.equal(result.status,exit);assert.equal(result.stdout,'');
  const lines=result.stderr.trim().split(/\r?\n/);
  assert(lines.includes(expected));assert(lines.every(line=>/^(?:NEON_CLI_|FIXTURE_)[A-Z0-9_]+$/.test(line)));
  assert(!/synthetic-|https?:|Auth Url:|code=|access_token|refresh_token/.test(result.stdout+result.stderr));
  if(exit===0){
   const profiles=JSON.parse(await readFile(join(fixture,'profiles.json'),'utf8'));
   assert.deepEqual(Object.keys(profiles.profiles).sort(),['DEFAULT',PROFILE].sort());assert(profiles.profiles[PROFILE]);
   assert(lines.includes('NEON_CLI_CALLBACK_RECEIVED'));
  }else await assert.rejects(access(join(fixture,'profiles.json')));
  if(scenario==='early-probe')assert(lines.includes('NEON_CLI_CALLBACK_IGNORED'));
 }finally{await rm(fixture,{recursive:true,force:true});}
});
