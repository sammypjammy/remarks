import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
const synthetic='postgresql://DISTINCT_TRACE_USER:DISTINCT_TRACE_PASSWORD_83@ep-young-dream-arkoh9e5.c-4.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const quote=s=>"'"+s.replaceAll("'","''")+"'";
test('wrapper conversion/environment/pipe deliver exact synthetic plaintext to classifier after buffer cleanup',{skip:process.platform!=='win32'},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'fax-capture-proof-'));
 try{
  const probe=join(directory,'synthetic-probe.mjs'),wrapper=join(directory,'wrapper.ps1');
  const module=pathToFileURL(resolve('maintenance/fax-v3-production/input-diagnostic.mjs')).href;
  await writeFile(probe,`import {compareTransport,inputDiagnostics,invisibleDiagnostics} from ${JSON.stringify(module)};
   try {
    const expected=${JSON.stringify(synthetic)};
    if(process.env.DATABASE_URL!==expected)throw Error();
    if(await compareTransport(process.stdin,process.env.DATABASE_URL)!=='SECURE_INPUT_TRANSPORT_MATCH')throw Error();
    // compareTransport has now erased its temporary buffers. The exact immutable
    // environment string still enters BOTH classifiers and the URL parser.
    const value=process.env.DATABASE_URL;if(value!==expected)throw Error();
    if(inputDiagnostics(value).inputFormat!=='URI_SHAPE'||invisibleDiagnostics(value).invisibleClasses[0]!=='NONE_DETECTED')throw Error();
    const parsed=new URL(value);if(parsed.username!=='DISTINCT_TRACE_USER'||parsed.password!=='DISTINCT_TRACE_PASSWORD_83')throw Error();
    console.log('SYNTHETIC_PLAINTEXT_PROVEN_BEFORE_AND_AFTER_COMPARISON');
   }catch{console.log('SYNTHETIC_CAPTURE_PROOF_FAILED');process.exitCode=1;}
  `);
  const original=await readFile('maintenance/fax-v3-production/preflight-private.ps1','utf8');
  // Only change the child entry to an OFFLINE assertion probe, retaining the real
  // conversion, handoff, pipe and cleanup code. No production data is involved.
  const changed=original.replace("Join-Path $PSScriptRoot 'identity-diagnostic.mjs'",quote(probe));assert.notEqual(changed,original);await writeFile(wrapper,changed);
  const script=`function Read-Host { param([string]$Prompt,[switch]$AsSecureString) ConvertTo-SecureString $env:FAX_SYNTHETIC_INPUT -AsPlainText -Force }
   & ${quote(wrapper)} -IdentityOnly -TargetFile ${quote(resolve('maintenance/fax-v3-production/target.example.json'))}`;
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true,env:{...process.env,FAX_SYNTHETIC_INPUT:synthetic},timeout:15000});
  assert.equal(r.status,0);assert.equal(r.stderr,'');assert.equal(r.stdout.trim(),'SYNTHETIC_PLAINTEXT_PROVEN_BEFORE_AND_AFTER_COMPARISON');
 }finally{assert(resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});}
});
test('control-only capture stops before Node resolution, without values or automatic repair',{skip:process.platform!=='win32'},()=>{
 const script=`function Read-Host { param([string]$Prompt,[switch]$AsSecureString) ConvertTo-SecureString ([string][char]22) -AsPlainText -Force }
  function Get-Command { throw 'NODE_MUST_NOT_BE_RESOLVED' }
  & './maintenance/fax-v3-production/preflight-private.ps1' -IdentityOnly -TargetFile './maintenance/fax-v3-production/target.example.json'`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true});
 assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr.trim(),'SECURE_INPUT_CONTROL_ONLY_CAPTURE_REJECTED_USE_TERMINAL_PASTE');
});
