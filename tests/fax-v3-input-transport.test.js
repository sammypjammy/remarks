import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {Readable} from 'node:stream';import {inputDiagnostics,compareTransport} from '../maintenance/fax-v3-production/input-diagnostic.mjs';
const prefix='postgresql://synthetic:',suffix='@ep-young-dream-arkoh9e5.c-4.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const uri=prefix+'synthetic-password'+suffix;
const cases=[
 [uri,'PASS','URI_SHAPE'],
 [prefix+encodeURIComponent('synthetic /?#@:% $&!^() ?')+suffix,'PASS','URI_SHAPE'],
 [prefix+'synthetic$&!^()%,:;=@'+suffix,'PASS','URI_SHAPE'],
 [prefix+'synthetic/unescaped'+suffix,'URL_MALFORMED','URI_SHAPE'],
 [prefix+'synthetic?unescaped'+suffix,'URL_MALFORMED','URI_SHAPE'],
 ['psql '+uri,'URL_COPY_FORMAT_INVALID','COMMAND_OR_ASSIGNMENT'],
 ['"'+uri+'"','URL_COPY_FORMAT_INVALID','QUOTED_INPUT'],
 ['DATABASE_URL='+uri,'URL_MALFORMED','COMMAND_OR_ASSIGNMENT'],
 ['\u200b'+uri,'URL_MALFORMED','WHITESPACE_OR_CONTROL_INPUT'],
 [uri+'\r\n','URL_COPY_FORMAT_INVALID','WHITESPACE_OR_CONTROL_INPUT'],
 ['not-a-uri','URL_MALFORMED','SCHEME_MISSING_OR_NONSTANDARD']
];

test('actual PowerShell SecureString conversion and child environment preserve synthetic clipboard-style inputs',{skip:process.platform!=='win32'},()=>{
 for(const [input,policy,format]of cases){
  // Fake only Read-Host, using synthetic fixture data. Execute the REAL wrapper,
  // BSTR conversion, environment assignment, pipe, child parser and output path.
  const script=`function Read-Host { param([string]$Prompt,[switch]$AsSecureString) ConvertTo-SecureString $env:FAX_SYNTHETIC_INPUT -AsPlainText -Force }
  & './maintenance/fax-v3-production/preflight-private.ps1' -TargetFile './maintenance/fax-v3-production/target.example.json' -IdentityOnly`;
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,FAX_SYNTHETIC_INPUT:input}});
  assert.equal(r.status,1);assert.equal(r.stderr,'');
  const out=JSON.parse(r.stdout);assert.equal(out.inputTransport,'SECURE_INPUT_TRANSPORT_MATCH');assert.equal(out.urlPolicy,policy);assert.equal(out.inputFormat,format);
  assert(!r.stdout.includes('synthetic'));assert(!r.stdout.includes('ep-young'));assert(!r.stdout.includes('password'));assert(!r.stdout.includes('postgresql'));
 }
});

test('transport comparison reports mismatch/failure without parsing a changed value',async()=>{
 assert.equal(await compareTransport(Readable.from([Buffer.from(uri,'utf16le')]),uri),'SECURE_INPUT_TRANSPORT_MATCH');
 assert.equal(await compareTransport(Readable.from([Buffer.from('different','utf16le')]),uri),'SECURE_INPUT_TRANSPORT_MISMATCH');
 assert.equal(await compareTransport(Readable.from([Buffer.alloc(262146)]),uri),'SECURE_INPUT_TRANSPORT_FAILED');
 const r=spawnSync(process.execPath,['maintenance/fax-v3-production/identity-diagnostic.mjs','--target','unused.json','--verify-transport'],{input:Buffer.from('different','utf16le'),encoding:'utf8',env:{...process.env,DATABASE_URL:uri},windowsHide:true});
 assert.equal(r.status,1);assert.equal(r.stderr,'');assert.deepEqual(JSON.parse(r.stdout),{mode:'OFFLINE_IDENTITY_ONLY_NO_DATABASE_CONNECTION',inputTransport:'SECURE_INPUT_TRANSPORT_MISMATCH'});
});

test('encoding and parser diagnostics use categories, never input pieces or automatic repair',()=>{
 assert.equal(inputDiagnostics(prefix+'synthetic/unescaped'+suffix).credentialEncoding,'UNESCAPED_USERINFO_DELIMITER_SUSPECTED');
 assert.equal(inputDiagnostics(prefix+'synthetic%zz'+suffix).credentialEncoding,'PERCENT_ENCODING_INVALID');
 for(const [input]of cases){const out=inputDiagnostics(input);assert(Object.values(out).every(v=>/^[A-Z_]+$/.test(v)));assert(!JSON.stringify(out).includes('synthetic'));}
});
