import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {cliEnvironment,configDirectory,createNeonMetadata,executeCli,requireOAuthProfile,sessionAction,logoutEvidence,METADATA_PATHS,PROFILE} from '../maintenance/fax-v3-production/neon-cli.mjs';
import {guardedFetch} from '../maintenance/fax-v3-production/neon-fetch-guard.mjs';

const profile={name:PROFILE,auth:'oauth',storage:'keyring',file:'ok'};
const authContext=()=>({source:'stored-credentials',profile:PROFILE,storage:'keyring'});
const url='https://console.neon.tech/api/v2'+METADATA_PATHS[0];

test('CLI child receives OS settings only; credentials, custom hosts, proxy, debug and preload settings cannot propagate',()=>{
 const env={SystemRoot:'C:\\Windows',LOCALAPPDATA:tmpdir(),PATH:'synthetic-path',DATABASE_URL:'private-db-canary',NEON_API_KEY:'private-token-canary',NEON_PROFILE:'wrong',NEON_API_HOST:'https://wrong.invalid',NODE_OPTIONS:'--inspect',NODE_DEBUG:'http',NODE_TLS_REJECT_UNAUTHORIZED:'0',HTTPS_PROXY:'private-proxy-canary',DEBUG:'*',RC_TOKEN_ENCRYPTION_KEY_V1:'private-key-canary',HOME:'wrong',CI:'false'};
 assert.deepEqual(cliEnvironment(env),{SystemRoot:env.SystemRoot,LOCALAPPDATA:env.LOCALAPPDATA,PATH:env.PATH,CI:'true',NO_UPDATE_NOTIFIER:'1',NO_COLOR:'1'});
 assert.equal(cliEnvironment(env,true).CI,'false');
 assert.equal(configDirectory(env),join(tmpdir(),'PackardToolkit','fax-v3-neon-cli'));
 assert.throws(()=>configDirectory({LOCALAPPDATA:'relative'}));
});

test('only the named OAuth/keyring profile permits the three fixed metadata reads',async()=>{
 const calls=[];
 const read=createNeonMetadata({env:{},execute:async(action,path)=>{calls.push([action,path]);return action==='profiles'?[profile]:{fixture:path};}});
 for(const path of METADATA_PATHS)assert.deepEqual(await read(path),{fixture:path});
 assert.deepEqual(calls,[['profiles',undefined],...METADATA_PATHS.map(p=>['metadata',p])]);
 await assert.rejects(read('/projects/other/endpoints/unknown'));
 assert.equal(calls.length,4);
 for(const rows of [null,[],[profile,profile],[{...profile,name:'DEFAULT'}],[{...profile,auth:'api key'}],[{...profile,storage:'file'}],[{...profile,file:'unreadable'}]]){
  assert.throws(()=>requireOAuthProfile(rows));
  let invoked=0;const blocked=createNeonMetadata({execute:async()=>{invoked++;return rows;}});
  await assert.rejects(blocked(METADATA_PATHS[0]));assert.equal(invoked,1);
 }
});

test('transport requires live OAuth context, exact HTTPS GET and redirect rejection, with no metadata replay',async()=>{
 const calls=[];
 const guarded=guardedFetch({action:'metadata',path:METADATA_PATHS[0],authContext,fetchImpl:async(input,init)=>{calls.push({input,init});return new Response('{}');}});
 await guarded(url,{headers:{Authorization:'Bearer private-synthetic-canary'}});
 assert.equal(calls.length,1);assert.equal(calls[0].init.redirect,'error');assert(calls[0].init.signal instanceof AbortSignal);
 await assert.rejects(guarded(url));assert.equal(calls.length,1);
 for(const context of [null,{...authContext(),source:'profile-api-key'},{...authContext(),profile:'DEFAULT'},{...authContext(),storage:'file'}]){
  let sent=0;const blocked=guardedFetch({action:'metadata',path:METADATA_PATHS[0],authContext:()=>context,fetchImpl:async()=>{sent++;}});
  await assert.rejects(blocked(url));assert.equal(sent,0);
 }
 for(const [input,init]of [[url,{method:'POST'}],[url,{method:'GET',body:'private'}],[url+'?extra=1',{}],[url+'#fragment',{}],[url.replace('https:','http:'),{}],['https://wrong.invalid'+METADATA_PATHS[0],{}],['https://private-user:private-pass@console.neon.tech/api/v2'+METADATA_PATHS[0],{}],['https://console.neon.tech/api/v2/projects',{}]]){
  let sent=0;const blocked=guardedFetch({action:'metadata',path:METADATA_PATHS[0],authContext,fetchImpl:async()=>{sent++;}});
  await assert.rejects(blocked(input,init));assert.equal(sent,0);
 }
 for(const status of [301,302,307,308]){
  const redirect=guardedFetch({action:'metadata',path:METADATA_PATHS[0],authContext,fetchImpl:async()=>new Response(null,{status,headers:{Location:'https://wrong.invalid'}})});
  await assert.rejects(redirect(url));
 }
});

test('OAuth refresh is confined to official host; profile inspection has no network access',async()=>{
 const calls=[];const fetchImpl=async(input,init)=>{calls.push({input,init});return new Response('{}');};
 const guarded=guardedFetch({action:'metadata',path:METADATA_PATHS[0],authContext,fetchImpl});
 await guarded('https://oauth2.neon.tech/.well-known/openid-configuration');
 await guarded('https://oauth2.neon.tech/token',{method:'POST',body:'private-synthetic-canary'});
 assert.equal(calls.length,2);assert(calls.every(c=>c.init.redirect==='error'));
 await assert.rejects(guarded('https://oauth2.neon.tech/token',{method:'DELETE'}));
 await assert.rejects(guarded('https://different-oauth.invalid/token',{method:'POST'}));
 const offline=guardedFetch({action:'profiles',fetchImpl});
 await assert.rejects(offline('https://oauth2.neon.tech/.well-known/openid-configuration'));
 await assert.rejects(offline(url));assert.equal(calls.length,2);
});

test('official pinned CLI local profile listing works without login, network or touching the operator profile',async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'fax-neon-offline-'));
 try{
  const env={...cliEnvironment(process.env),LOCALAPPDATA:fixture};
  const rows=await executeCli('profiles',undefined,{env});
  assert(Array.isArray(rows));assert(!rows.some(r=>r.name===PROFILE));
  await assert.rejects(createNeonMetadata({env})(METADATA_PATHS[0]),{message:'NEON_CLI_VERIFICATION_FAILED'});
  for(const [action,path]of [['delete'],['metadata','/projects/other'],['auth','--api-key']])await assert.rejects(executeCli(action,path,{env}));
 }finally{await rm(fixture,{recursive:true,force:true});}
});

test('private session command rejects unknown actions and the database wrapper asks for no Neon secret',async()=>{
 const r=spawnSync(process.execPath,['maintenance/fax-v3-production/neon-session.mjs','--api-key'],{env:cliEnvironment(process.env),encoding:'utf8',windowsHide:true});
 assert.equal(r.status,1);assert.equal(r.stdout.trim(),'NEON_CLI_SESSION_FAILED_STOP');assert.equal(r.stderr,'');
 const wrapper=await readFile(new URL('../maintenance/fax-v3-production/preflight-private.ps1',import.meta.url),'utf8');
 assert.equal((wrapper.match(/Read-Host/g)||[]).length,1);
 assert(wrapper.includes('-AsSecureString'));
 assert(!wrapper.includes('Neon read-only API credential'));
});

test('browser session setup never replaces a profile or falls back to a key/file; logout requires confirmed revocation and cleanup',async()=>{
 const calls=[],logs=[];let listing=0;
 assert.equal(await sessionAction('auth',{log:s=>logs.push(s),execute:async action=>{calls.push(action);return action==='profiles'?(listing++?[profile]:[]):undefined;}}),0);
 assert.deepEqual(calls,['profiles','auth','profiles']);assert.equal(logs.at(-1),'NEON_CLI_OAUTH_KEYRING_READY');
 for(const rows of [[profile],[{...profile,auth:'api key'}],[{...profile,storage:'file'}]]){
  const actions=[];await assert.rejects(sessionAction('auth',{execute:async action=>{actions.push(action);return rows;}}));assert.deepEqual(actions,['profiles']);
 }
 const confirmed=`INFO Revoked the OAuth token\nINFO Deleted the OS keyring item for profile "${PROFILE}"`;
 assert.deepEqual(logoutEvidence(confirmed),{revoked:true,removed:true});
 assert.equal(logoutEvidence('Could not revoke the OAuth token — removing locally anyway').revoked,false);
 for(const result of [{revoked:true,removed:true},{revoked:false,removed:true},{revoked:true,removed:false}]){
  const output=[],actions=[];
  const code=await sessionAction('logout',{log:s=>output.push(s),execute:async action=>{actions.push(action);return action==='profiles'?[profile]:result;}});
  assert.deepEqual(actions,['profiles','logout']);assert.equal(code,result.revoked&&result.removed?0:1);
  assert.deepEqual(output,[code===0?'NEON_CLI_SESSION_REVOKED_AND_REMOVED':'NEON_CLI_LOGOUT_UNCONFIRMED_STOP']);
 }
});

test('npm-installed Windows keyring addon loads without reading or changing credentials',{skip:process.platform!=='win32'},async()=>{
 const addon=await import('../maintenance/fax-v3-production/node_modules/@napi-rs/keyring/index.js');
 assert.equal(typeof addon.Entry,'function');
});
