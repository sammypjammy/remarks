import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
test('private key comparator returns only SAME/DIFFERENT and rejects invalid keys',{skip:process.platform!=='win32'},()=>{
 const code=`Import-Module './maintenance/fax-v3-production/PrivateKeyComparison.psm1' -Force
 $a=ConvertTo-SecureString ([Convert]::ToBase64String([byte[]](1..32))) -AsPlainText -Force
 $b=ConvertTo-SecureString ([Convert]::ToBase64String([byte[]](2..33))) -AsPlainText -Force
 Compare-ToolkitEncryptionKeys $a $a
 Compare-ToolkitEncryptionKeys $a $b
 try { Compare-ToolkitEncryptionKeys $a (ConvertTo-SecureString 'invalid-private-canary' -AsPlainText -Force) } catch { 'INVALID_REJECTED' }
 $a.Dispose();$b.Dispose()`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',code],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0);assert.equal(r.stdout.replaceAll('\r','').trim(),'SAME\nDIFFERENT\nINVALID_REJECTED');assert.equal(r.stderr,'');
});
test('read-only entry refuses mutation flags and apply entry refuses missing authorization before network',()=>{
 for(const [file,args]of [['preflight.mjs',['--apply','--production','--target','nonexistent.json','--authorize','APPLY_002_003_TO_PRODUCTION','--expires-at',new Date(Date.now()+600000).toISOString()]],['apply.mjs',[]]]){
  const r=spawnSync(process.execPath,['maintenance/fax-v3-production/'+file,...args],{encoding:'utf8',env:{...process.env,DATABASE_URL:'invalid-private-canary',NEON_API_KEY:''},windowsHide:true});assert.equal(r.status,1);assert.equal(r.stdout.trim(),'CONFIGURATION_OR_AUTHORIZATION_FAILED');assert.equal(r.stderr,'');
 }
});
