import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {checkedUrl} from '../maintenance/fax-v3-production/url-identity.mjs';
import {identityReason} from '../maintenance/fax-v3-production/identity-errors.mjs';
import {targetConfig} from '../maintenance/fax-v3-production/policy.mjs';
import {connectionCheck} from '../maintenance/verify-production/validate.mjs';
const host='ep-young-dream-arkoh9e5.c-4.us-west-2.aws.neon.tech';
const uri='postgresql://synthetic:secret-canary@'+host+'/neondb?sslmode=require&channel_binding=require';
const record=()=>({environment:'production',project:'fragrant-block-21191473',branch:'br-silent-lab-arnl9ia9',endpoint:'ep-young-dream-arkoh9e5',developmentBranch:'br-morning-heart-ar9vtw8o',developmentEndpoint:'ep-jolly-lake-ar7x7r37',database:'neondb',host,verifiedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),confirmations:{productionAttachedToMain:true,developmentAttachedToDevelopment:true,productionReadWrite:true,distinct:true,noAdministrativeChanges:true}});
const env={VERCEL_ENV:'production',TOOLKIT_ORIGIN:'https://packardtoolkit.vercel.app',DATABASE_URL:uri};
const reason=fn=>{try{fn();return 'PASS';}catch(error){return identityReason(error);}};

test('reported cell hostname and official parameter forms pass without changing the shared URL acceptance policy',()=>{
 for(const u of [uri,uri.replace('&channel_binding=require',''),uri.split('?')[0]]){
  assert.equal(connectionCheck(u,{production:true}),'PASS');assert.equal(checkedUrl(u).hostname,host);assert.equal(targetConfig({...env,DATABASE_URL:u},record(),{apply:true}).host,host);
 }
 const cases=[['','URL_MISSING'],['invalid','URL_MALFORMED'],['psql '+uri,'URL_COPY_FORMAT_INVALID'],[uri+'\n','URL_COPY_FORMAT_INVALID'],['"'+uri+'"','URL_COPY_FORMAT_INVALID'],[uri.replace('postgresql:','https:'),'URL_PROTOCOL_INVALID'],[uri.replace(':secret-canary',''),'URL_CREDENTIAL_FIELDS_MISSING'],[uri.replace('/neondb?','/?'),'URL_DATABASE_PATH_INVALID'],[uri.replace('/neondb?',':5433/neondb?'),'URL_PORT_FORBIDDEN'],[uri+'&sslmode=require','URL_PARAMETER_DUPLICATE'],[uri.replace('sslmode=require','sslmode=disable'),'URL_SSLMODE_INVALID'],[uri.replace('channel_binding=require','channel_binding=prefer'),'URL_CHANNEL_BINDING_INVALID'],[uri+'&secret-canary=secret-canary','URL_PARAMETER_FORBIDDEN'],[uri.replace(host,'evil.invalid'),'URL_HOST_INVALID'],[uri.replace('ep-young-dream-arkoh9e5','ep-jolly-lake-ar7x7r37'),'URL_ENDPOINT_MISMATCH']];
 for(const [input,code]of cases){assert.notEqual(connectionCheck(input,{production:true}),'PASS');assert.equal(reason(()=>checkedUrl(input)),code);}
 assert.equal(identityReason(Error(uri)),'IDENTITY_CHECK_FAILED');assert.equal(identityReason({reason:uri}),'IDENTITY_CHECK_FAILED');
});

test('identity failures identify database, host, pooler, attestation and environment separately',()=>{
 for(const [change,code]of [[{DATABASE_URL:uri.replace('/neondb?','/other?')},'DATABASE_NAME_MISMATCH'],[{DATABASE_URL:uri.replace('c-4.','c-5.')},'HOSTNAME_MISMATCH'],[{DATABASE_URL:uri.replace('ep-young-dream-arkoh9e5','ep-young-dream-arkoh9e5-pooler')},'POOLING_FORBIDDEN'],[{VERCEL_ENV:'preview'},'ENVIRONMENT_MISMATCH'],[{TOOLKIT_ORIGIN:'https://wrong.invalid'},'ORIGIN_MISMATCH']])assert.equal(reason(()=>targetConfig({...env,...change},record(),{apply:true})),code);
 for(const [change,code]of [[{project:'unknown'},'ATTESTATION_ID_MISMATCH'],[{extra:true},'TARGET_RECORD_INVALID'],[{confirmations:{}},'ATTESTATION_CONFIRMATION_INVALID'],[{host:'wrong.invalid'},'ATTESTATION_HOST_INVALID'],[{verifiedAt:'invalid'},'ATTESTATION_TIME_INVALID'],[{verifiedAt:new Date(Date.now()+300000).toISOString()},'ATTESTATION_FUTURE'],[{expiresAt:new Date(Date.now()-500).toISOString()},'ATTESTATION_EXPIRED'],[{expiresAt:new Date(Date.now()+1800000).toISOString()},'ATTESTATION_WINDOW_INVALID']])assert.equal(reason(()=>targetConfig(env,{...record(),...change})),code);
});

test('offline diagnostic reports only fixed codes, works with networking and pg imports forbidden, and separates expiry from URL errors',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'fax-identity-offline-')),path=join(directory,'synthetic.json');
 try{
  for(const scenario of ['pass','expired','forbidden-parameter','malformed-record']){
   const target=record();if(scenario==='expired'){target.verifiedAt=new Date(Date.now()-1200000).toISOString();target.expiresAt=new Date(Date.now()-300000).toISOString();}
   await writeFile(path,scenario==='malformed-record'?'secret-canary':JSON.stringify(target));
   const script=`
    import {registerHooks} from 'node:module';
    registerHooks({resolve(name,context,next){if(/^(?:node:)?(?:net|tls|dns|http|https|http2|child_process)$/.test(name)||name==='pg')throw Error('NETWORK_IMPORT_FORBIDDEN');return next(name,context);}});
    globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
    process.argv=[process.execPath,'fixture','--target',${JSON.stringify(path)}];
    await import('./maintenance/fax-v3-production/identity-diagnostic.mjs');
   `;
   const r=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true,env:{...process.env,...env,DATABASE_URL:scenario==='forbidden-parameter'?uri+'&secret-canary=secret-canary':uri}});
   assert.equal(r.status,scenario==='pass'?0:1);assert.equal(r.stderr,'');assert(!r.stdout.includes('secret-canary'));assert(!r.stdout.includes(host));assert(!r.stdout.includes(path));
   const out=JSON.parse(r.stdout);assert.equal(out.mode,'OFFLINE_IDENTITY_ONLY_NO_DATABASE_CONNECTION');assert.equal(out.urlPolicy,scenario==='forbidden-parameter'?'URL_PARAMETER_FORBIDDEN':'PASS');assert.equal(out.preflightIdentity,({pass:'PASS',expired:'ATTESTATION_EXPIRED','forbidden-parameter':'URL_PARAMETER_FORBIDDEN','malformed-record':'TARGET_RECORD_INVALID'})[scenario]);
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('PowerShell refuses mixed diagnostic/inspect modes before reading a secret',{skip:process.platform!=='win32'},()=>{
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','maintenance/fax-v3-production/preflight-private.ps1','-TargetFile','unused.json','-Inspect','-IdentityOnly'],{encoding:'utf8',windowsHide:true});
 assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr.trim(),'PREFLIGHT_WRAPPER_FAILED');
});
