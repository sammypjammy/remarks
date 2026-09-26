import {createHash} from 'node:crypto';
import {checkedUrl} from './url-identity.mjs';
import {rejectIdentity as reject} from './identity-errors.mjs';
export const ENDPOINT='ep-young-dream-arkoh9e5';
export const DEVELOPMENT_ENDPOINT='ep-jolly-lake-ar7x7r37';
export const PROJECT='fragrant-block-21191473';
export const BRANCH='br-silent-lab-arnl9ia9';
export const DATABASE='neondb';
export const DEVELOPMENT_BRANCH='br-morning-heart-ar9vtw8o';
export const ATTESTATION_MS=15*60*1000;
export const HASHES={
 '001_toolkit_auth':'d25c789f9fe3840a3f061f40dddc02578df2f1e0b91f4ed07f9508bac8f0b605',
 '002_ringcentral_v3':'18c3b3e91394d0d14f859ddc8e15873d6eec1fd7bd5ef5bccf9fb00fd06c598b',
 '003_fax_v3_operations':'f6a40bf340ec6d81a34fb7a4cd9035ddf6835bb7ce3c048694524e7ca0a9250e'
};
export const digest=s=>createHash('sha256').update(s.replaceAll('\r\n','\n')).digest('hex');
export const fail=()=>{throw Error('VERIFICATION_FAILED');};
// Human dashboard attestation, NOT a live Neon API assertion. Reject extra fields
// so an accidental connection string or other secret cannot enter identity output.
export function attestedIdentity(target,now=Date.now()) {
 const keys=['environment','endpoint','project','branch','developmentBranch','developmentEndpoint','database','host','verifiedAt','expiresAt','confirmations'];
 if(!target || Object.keys(target).sort().join()!==keys.sort().join())reject('TARGET_RECORD_INVALID');
 if(target.environment!=='production'||target.endpoint!==ENDPOINT||target.project!==PROJECT||target.branch!==BRANCH||target.developmentBranch!==DEVELOPMENT_BRANCH||target.developmentEndpoint!==DEVELOPMENT_ENDPOINT||target.database!==DATABASE)reject('ATTESTATION_ID_MISMATCH');
 const c=target.confirmations;
 if(!c || Object.keys(c).sort().join()!==['productionAttachedToMain','developmentAttachedToDevelopment','productionReadWrite','distinct','noAdministrativeChanges'].sort().join() || Object.values(c).some(v=>v!==true))reject('ATTESTATION_CONFIRMATION_INVALID');
 // Dashboard supplies the full DIRECT hostname. Never derive it from DATABASE_URL.
 if(typeof target.host!=='string'||target.host!==target.host.toLowerCase()||!new RegExp('^'+ENDPOINT+'\\.(?:c-[1-9][0-9]*\\.)?[a-z0-9]+(?:-[a-z0-9]+)*\\.(aws|azure)\\.neon\\.tech$').test(target.host))reject('ATTESTATION_HOST_INVALID');
 assertFresh(target,now);
 return {environment:'production',project:PROJECT,branch:BRANCH,endpoint:ENDPOINT,database:DATABASE,host:target.host,identityVerification:'operator-dashboard-attestation',verifiedAt:target.verifiedAt,expiresAt:target.expiresAt};
}
export function assertFresh(target,now=Date.now()) {
 const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 if(!stamp(target?.verifiedAt)||!stamp(target?.expiresAt)||!Number.isFinite(now))reject('ATTESTATION_TIME_INVALID');
 const verified=Date.parse(target.verifiedAt),expires=Date.parse(target.expiresAt);
 if(verified>now)reject('ATTESTATION_FUTURE');
 if(expires<=verified||expires-verified>ATTESTATION_MS)reject('ATTESTATION_WINDOW_INVALID');
 if(now-verified>=ATTESTATION_MS||expires<=now)reject('ATTESTATION_EXPIRED');
}
export function targetConfig(env,target,{apply=false,now=Date.now()}={}) {
 const identity=attestedIdentity(target,now);
 if(env.TOOLKIT_ORIGIN!=='https://packardtoolkit.vercel.app')reject('ORIGIN_MISMATCH');
 if(env.VERCEL_ENV!=='production')reject('ENVIRONMENT_MISMATCH');
 const url=checkedUrl(env.DATABASE_URL);
 let database;try{database=decodeURIComponent(url.pathname.slice(1));}catch{reject('URL_DATABASE_PATH_INVALID');}
 if(database!==DATABASE)reject('DATABASE_NAME_MISMATCH');
 if(apply&&url.hostname.split('.')[0].endsWith('-pooler'))reject('POOLING_FORBIDDEN');
 if(url.hostname.replace('-pooler.','.')!==identity.host)reject('HOSTNAME_MISMATCH');
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
