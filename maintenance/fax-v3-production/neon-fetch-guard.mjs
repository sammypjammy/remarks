import {METADATA_PATHS,PROFILE} from './neon-cli.mjs';

// Applied inside the official CLI process before importing its modules. The CLI
// alone handles OAuth credentials; this boundary never returns or logs them.
export function guardedFetch({action,path,fetchImpl,authContext=()=>null}) {
 let metadataSent=false;
 return async(input,init={})=>{
  const reject=()=>{throw Error('NEON_REQUEST_REFUSED');};
  const url=new URL(input instanceof Request?input.url:String(input));
  const method=(init.method??(input instanceof Request?input.method:'GET')).toUpperCase();
  if(url.username || url.password || url.hash || url.protocol!=='https:')reject();
  const oauth=url.origin==='https://oauth2.neon.tech' && ['GET','POST'].includes(method) && action!=='profiles';
  const metadata=action==='metadata' && METADATA_PATHS.includes(path) && url.href==='https://console.neon.tech/api/v2'+path && method==='GET';
  const account=action==='auth' && url.href==='https://console.neon.tech/api/v2/users/me' && method==='GET';
  if(!oauth&&!metadata&&!account)reject();
  if(metadata){
   const context=authContext();
   if(metadataSent || context?.source!=='stored-credentials' || context.profile!==PROFILE || context.storage!=='keyring' || init.body!=null || (input instanceof Request&&input.body!==null))reject();
   metadataSent=true; // No replay, including automatic CLI recovery after HTTP 401.
  }
  const signal=AbortSignal.timeout(10000);
  const prior=init.signal??(input instanceof Request?input.signal:undefined);
  const response=await fetchImpl(input,{...init,redirect:'error',signal:prior?AbortSignal.any([prior,signal]):signal});
  if(response.status>=300&&response.status<400 || response.redirected)reject();
  return response;
 };
}
