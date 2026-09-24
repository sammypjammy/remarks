import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROJECT,BRANCH,ENDPOINT,DEVELOPMENT_ENDPOINT} from './policy.mjs';

export const PROFILE='fax-v3-production-preflight';
export const CLI_VERSION='6.1.0';
export const METADATA_PATHS=Object.freeze([
 `/projects/${PROJECT}/endpoints/${ENDPOINT}`,
 `/projects/${PROJECT}/endpoints/${DEVELOPMENT_ENDPOINT}`,
 `/projects/${PROJECT}/branches/${BRANCH}`
]);
const directory=dirname(fileURLToPath(import.meta.url));
const stop=()=>{throw Error('NEON_CLI_VERIFICATION_FAILED');};

// No inherited API keys, database URLs, proxy settings, custom hosts, debug/preload
// settings, telemetry, or arbitrary environment variables enter the CLI process.
export function cliEnvironment(env,interactive=false) {
 const allowed=new Set(['systemroot','windir','comspec','path','pathext','userprofile','appdata','localappdata','temp','tmp']);
 const clean=Object.fromEntries(Object.entries(env).filter(([k,v])=>allowed.has(k.toLowerCase())&&typeof v==='string'));
 return {...clean,CI:interactive?'false':'true',NO_UPDATE_NOTIFIER:'1',NO_COLOR:'1'};
}
export function configDirectory(env) {
 const local=Object.entries(env).find(([k])=>k.toLowerCase()==='localappdata')?.[1];
 if(!local || !isAbsolute(local))stop();
 return join(local,'PackardToolkit','fax-v3-neon-cli');
}
export async function executeCli(action,path,{env=process.env}={}) {
 if(!['profiles','metadata','auth','logout'].includes(action) || (action==='metadata'?!METADATA_PATHS.includes(path):path!==undefined))stop();
 try {
  const pkg=JSON.parse(await readFile(join(directory,'node_modules/neon/package.json'),'utf8'));
  if(pkg.name!=='neon' || pkg.version!==CLI_VERSION || pkg.bin?.neon!=='dist/cli.js')stop();
  const childEnv=cliEnvironment(env,action==='auth');
  const config=configDirectory(childEnv);
  return await new Promise((resolve,reject)=>{
   const child=execFile(process.execPath,[join(directory,'neon-process.mjs'),action,config,...(path?[path]:[])],{
    env:childEnv,cwd:directory,shell:false,windowsHide:true,timeout:action==='auth'?90000:45000,maxBuffer:512*1024,encoding:'utf8'
   },(error,stdout,stderr)=>{
    // Never forward upstream messages, URLs, headers, or error objects.
    if(error)return reject(Error('NEON_CLI_VERIFICATION_FAILED'));
    if(action==='logout')return resolve(logoutEvidence(stderr));
    if(action==='auth')return resolve(undefined);
    try{resolve(JSON.parse(stdout));}catch{reject(Error('NEON_CLI_VERIFICATION_FAILED'));}
   });
   child.stdin.end();
  });
 }catch{stop();}
}
export function requireOAuthProfile(rows) {
 if(!Array.isArray(rows))stop();
 const matches=rows.filter(r=>r?.name===PROFILE);
 if(matches.length!==1 || matches[0].auth!=='oauth' || matches[0].storage!=='keyring' || matches[0].file!=='ok')stop();
}
export function createNeonMetadata({env=process.env,execute=executeCli}={}) {
 let verified=false;
 return async path=>{
  if(!METADATA_PATHS.includes(path))stop();
  if(!verified){requireOAuthProfile(await execute('profiles',undefined,{env}));verified=true;}
  return execute('metadata',path,{env});
 };
}
export function logoutEvidence(stderr) {
 return {
  revoked:stderr.includes('Revoked the OAuth token')&&!stderr.includes('Could not revoke'),
  removed:stderr.includes(`Deleted the OS keyring item for profile "${PROFILE}"`)&&!stderr.includes('Could not confirm')
 };
}
export async function sessionAction(action,{execute=executeCli,log=console.log}={}) {
 if(!['auth','logout'].includes(action))stop();
 const rows=await execute('profiles');
 if(action==='auth'){
  // Do not replace/revoke an existing session or API key as a side effect of login.
  if(!Array.isArray(rows)||rows.some(r=>r?.name===PROFILE))stop();
  log('Complete Neon CLI authentication in the browser. No credentials need to be copied.');
  await execute('auth');
  requireOAuthProfile(await execute('profiles'));
  log('NEON_CLI_OAUTH_KEYRING_READY');return 0;
 }
 requireOAuthProfile(rows);
 const result=await execute('logout');
 if(!result.revoked || !result.removed){log('NEON_CLI_LOGOUT_UNCONFIRMED_STOP');return 1;}
 log('NEON_CLI_SESSION_REVOKED_AND_REMOVED');return 0;
}
