import {access} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROFILE,METADATA_PATHS} from './neon-cli.mjs';
import {guardedFetch} from './neon-fetch-guard.mjs';

// Internal subprocess entry. Its stdout/stderr are always captured by neon-cli.
try {
 const [action,config,path,...extra]=process.argv.slice(2);
 if(extra.length || !isAbsolute(config||'') || !['profiles','metadata','auth','logout'].includes(action) || (action==='metadata'?!METADATA_PATHS.includes(path):path!==undefined))throw Error();
 const context=join(config,'unused-context.json');
 // Refuse an ambient CLI context instead of inheriting project/auth selection.
 try{await access(context);throw Error('CONTEXT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw Error();}
 const {getAuthContext}=await import('./node_modules/neon/dist/auth_context.js');
 globalThis.fetch=guardedFetch({action,path,fetchImpl:globalThis.fetch,authContext:getAuthContext});
 const common=['--config-dir',config,'--context-file',context,'--api-host','https://console.neon.tech/api/v2','--oauth-host','https://oauth2.neon.tech','--client-id','neonctl','--no-analytics','--no-color','--output','json'];
 const command=action==='profiles'?['profile','list']:action==='metadata'?['api',path,'--method','GET','--profile',PROFILE]:action==='auth'?['auth','--profile',PROFILE,'--keyring']:['profile','remove',PROFILE,'--yes'];
 const cli=fileURLToPath(new URL('./node_modules/neon/dist/cli.js',import.meta.url));
 process.argv=[process.execPath,cli,...command,...common];
 await import('./node_modules/neon/dist/cli.js');
}catch{console.error('NEON_CLI_FAILED');process.exitCode=1;}
