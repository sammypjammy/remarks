// Test-only injection at the OS process boundary. Production code has no fixture flag.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const [directory,scenario]=process.argv.slice(2);
const original=childProcess.execFile;
childProcess.execFile=(file,args,options,callback)=>original(file,
 ['--import',new URL('./neon-auth-fixture.mjs',import.meta.url).href,...args],
 {...options,env:{...options.env,FAX_NEON_FIXTURE_SCENARIO:scenario}},callback);
syncBuiltinESMExports();
const {executeCli}=await import('../maintenance/fax-v3-production/neon-cli.mjs');
const {AUTH_FAILURES}=await import('../maintenance/fax-v3-production/neon-auth-listener.mjs');
try{
 await executeCli('auth',undefined,{env:{...process.env,LOCALAPPDATA:directory},onProgress:value=>console.log(value)});
 console.log('FIXTURE_HELPER_AUTH_COMPLETED');
}catch(error){console.log(AUTH_FAILURES.includes(error?.message)?error.message:'FIXTURE_HELPER_FAILED');process.exitCode=1;}
