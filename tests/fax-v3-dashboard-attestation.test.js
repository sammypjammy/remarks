import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {attestedIdentity,ATTESTATION_MS} from '../maintenance/fax-v3-production/policy.mjs';
import {databaseOptions} from '../server/auth/database.js';

// Only synthetic answers and temporary output. No actual dashboard attestation,
// browser, credential store, HTTP or SQL connection is made by these tests.
for(const scenario of ['accepted','wrong-confirmation','invalid-host'])test('local dashboard record helper: '+scenario,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'fax-dashboard-test-')),out=join(directory,'synthetic-target.json');
 try{
  const answers=[scenario==='invalid-host'?'synthetic-private-url-canary':'ep-young-dream-arkoh9e5.us-east-1.aws.neon.tech','MAIN','DEVELOPMENT','READ_WRITE','DISTINCT',scenario==='wrong-confirmation'?'YES':'NO_ADMIN_CHANGES'];
  const script=`
   import {createRequire,syncBuiltinESMExports} from 'node:module';
   const readline=createRequire(import.meta.url)('node:readline/promises');
   const answers=${JSON.stringify(answers)};
   readline.createInterface=()=>({question:async()=>answers.shift(),close:()=>{}});
   syncBuiltinESMExports();
   Object.defineProperty(process.stdin,'isTTY',{value:true});
   Object.defineProperty(process.stdout,'isTTY',{value:true});
   globalThis.fetch=()=>{throw Error('NETWORK_NOT_ALLOWED');};
   process.argv=[process.execPath,'fixture','--out',${JSON.stringify(out)}];
   await import('./maintenance/fax-v3-production/attest-identity.mjs');
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,scenario==='accepted'?0:1);assert.equal(result.stderr,'');assert(!result.stdout.includes('synthetic-private-url-canary'));
  if(scenario==='accepted'){
   const record=JSON.parse(await readFile(out,'utf8'));
   assert.equal(attestedIdentity(record).identityVerification,'operator-dashboard-attestation');
   assert.equal(Date.parse(record.expiresAt)-Date.parse(record.verifiedAt),ATTESTATION_MS);
   assert(result.stdout.includes('DASHBOARD_ATTESTATION_RECORDED_NO_PREFLIGHT_RUN'));
  }else await assert.rejects(access(out));
 }finally{
  assert(resolve(directory).startsWith(resolve(tmpdir())));
  await rm(directory,{recursive:true,force:true});
 }
});

test('record helper refuses noninteractive input; template cannot be mistaken for verified identity',async()=>{
 const result=spawnSync(process.execPath,['maintenance/fax-v3-production/attest-identity.mjs','--out','unused.json'],{input:'MAIN\n',encoding:'utf8',windowsHide:true});
 assert.equal(result.status,1);assert.equal(result.stdout.trim(),'DASHBOARD_ATTESTATION_FAILED_NO_PREFLIGHT_RUN');assert.equal(result.stderr,'');
 const template=JSON.parse(await readFile('maintenance/fax-v3-production/target.example.json','utf8'));
 assert.throws(()=>attestedIdentity(template));
});

test('private SQL adapter keeps certificate verification and channel binding even with sslmode=require',()=>{
 const options=databaseOptions('postgresql://synthetic:synthetic@ep-young-dream-arkoh9e5.us-east-1.aws.neon.tech/neondb?sslmode=require');
 assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.enableChannelBinding,true);
 assert(!new URL(options.connectionString).searchParams.has('sslmode'));
});
