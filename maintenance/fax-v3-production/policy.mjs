import {createHash} from 'node:crypto';
import {connectionCheck} from '../verify-production/validate.mjs';
export const ENDPOINT='ep-young-dream-arkoh9e5';
export const DEVELOPMENT_ENDPOINT='ep-jolly-lake-ar7x7r37';
export const HASHES={
 '001_toolkit_auth':'d25c789f9fe3840a3f061f40dddc02578df2f1e0b91f4ed07f9508bac8f0b605',
 '002_ringcentral_v3':'18c3b3e91394d0d14f859ddc8e15873d6eec1fd7bd5ef5bccf9fb00fd06c598b',
 '003_fax_v3_operations':'f6a40bf340ec6d81a34fb7a4cd9035ddf6835bb7ce3c048694524e7ca0a9250e'
};
export const digest=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
export const fail=()=>{throw Error('VERIFICATION_FAILED');};
export function targetConfig(env,target,{apply=false}={}) {
 if(env.TOOLKIT_ORIGIN!=='https://packardtoolkit.vercel.app' || env.VERCEL_ENV!=='production' || connectionCheck(env.DATABASE_URL,{production:true})!=='PASS')fail();
 if(!target || target.environment!=='production' || target.endpoint!==ENDPOINT || !/^[a-z0-9-]+$/.test(target.project||'') || !/^br-[a-z0-9-]+$/.test(target.branch||'') || !/^br-[a-z0-9-]+$/.test(target.developmentBranch||'') || target.branch===target.developmentBranch || !/^[a-zA-Z0-9_-]{1,63}$/.test(target.database||''))fail();
 const url=new URL(env.DATABASE_URL);if(decodeURIComponent(url.pathname.slice(1))!==target.database || (apply && url.hostname.split('.')[0].endsWith('-pooler')))fail();
 if(!env.NEON_API_KEY)fail();
 return {environment:'production',project:target.project,branch:target.branch,endpoint:ENDPOINT,database:target.database,host:url.hostname.replace('-pooler.','.')};
}
export async function verifyNeon(env,target,request=fetch,options={}) {
 const identity=targetConfig(env,target,options);
 const get=async path=>{const r=await request('https://console.neon.tech/api/v2/projects/'+identity.project+path,{headers:{Authorization:'Bearer '+env.NEON_API_KEY},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)fail();return r.json();};
 const {endpoint}=await get('/endpoints/'+ENDPOINT);
 if(endpoint?.id!==ENDPOINT || endpoint.project_id!==identity.project || endpoint.branch_id!==identity.branch || endpoint.branch_id===target.developmentBranch || endpoint.host!==identity.host || endpoint.type!=='read_write')fail();
 const {endpoint:development}=await get('/endpoints/'+DEVELOPMENT_ENDPOINT);
 if(development?.id!==DEVELOPMENT_ENDPOINT || development.project_id!==identity.project || development.branch_id!==target.developmentBranch || development.branch_id===identity.branch)fail();
 const {branch}=await get('/branches/'+identity.branch);
 if(branch?.id!==identity.branch || branch.project_id!==identity.project || branch.id===target.developmentBranch)fail();
 return identity;
}
export function authorize(args,now=Date.now()) {
 const modes=['--read-only','--inspect','--apply'];const mode=args[0];
 if(!modes.includes(mode) || args[1]!=='--production' || args[2]!=='--target' || !args[3])fail();
 if(mode!=='--apply'){if(args.length!==4)fail();return {mode,targetPath:args[3]};}
 if(args.length!==8 || args[4]!=='--authorize' || args[5]!=='APPLY_002_003_TO_PRODUCTION' || args[6]!=='--expires-at')fail();
 const expires=Date.parse(args[7]);if(!Number.isFinite(expires)||expires<=now||expires-now>15*60*1000)fail();
 return {mode,targetPath:args[3],expires};
}
