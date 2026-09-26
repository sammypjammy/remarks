import {readFile} from 'node:fs/promises';
import {targetConfig} from './policy.mjs';
import {inputDiagnostics,compareTransport} from './input-diagnostic.mjs';
import {checkedUrl} from './url-identity.mjs';
import {identityReason,rejectIdentity} from './identity-errors.mjs';
// Deliberately separate entry point: no pg, runner, SQL, DNS, HTTP or child process.
// Independent URL policy result remains useful even if the attestation has expired.
const result={mode:'OFFLINE_IDENTITY_ONLY_NO_DATABASE_CONNECTION'};
const args=process.argv.slice(2);
const verifyTransport=args.length===3&&args[2]==='--verify-transport';
if(verifyTransport){
 result.inputTransport=await compareTransport(process.stdin,process.env.DATABASE_URL);
 if(result.inputTransport!=='SECURE_INPUT_TRANSPORT_MATCH'){
  console.log(JSON.stringify(result));process.exit(1);
 }
}else result.inputTransport='NOT_CHECKED_DIRECT_INVOCATION';
Object.assign(result,inputDiagnostics(process.env.DATABASE_URL));
try{checkedUrl(process.env.DATABASE_URL);result.urlPolicy='PASS';}catch(error){result.urlPolicy=identityReason(error);}
try{
 const [flag,path,...extra]=verifyTransport?args.slice(0,2):args;if(flag!=='--target'||!path||extra.length)rejectIdentity('TARGET_RECORD_INVALID');
 let target;try{target=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));}catch{rejectIdentity('TARGET_RECORD_INVALID');}
 targetConfig(process.env,target);result.preflightIdentity='PASS';
 // Report the separate runner's direct-connection rule without ever invoking it.
 try{targetConfig(process.env,target,{apply:true});result.migrationIdentity='PASS';}catch(error){result.migrationIdentity=identityReason(error);}
}catch(error){result.preflightIdentity=identityReason(error);}
console.log(JSON.stringify(result));
process.exitCode=result.preflightIdentity==='PASS'?0:1;
