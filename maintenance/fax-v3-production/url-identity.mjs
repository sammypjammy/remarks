import {connectionCheck} from '../verify-production/validate.mjs';
import {rejectIdentity as reject} from './identity-errors.mjs';
// Existing shared validator remains the acceptance authority. Refinement below
// only classifies rejected input, never rescues/normalizes it into acceptance.
export function checkedUrl(value) {
 const verdict=connectionCheck(value,{production:true});
 if(verdict==='PASS')return new URL(value);
 if(typeof value!=='string'||!value)reject('URL_MISSING');
 if(/[\s\\#]/u.test(value)||/^["']|["']$/.test(value))reject('URL_COPY_FORMAT_INVALID');
 let url;try{url=new URL(value);}catch{reject('URL_MALFORMED');}
 if(!['postgres:','postgresql:'].includes(url.protocol))reject('URL_PROTOCOL_INVALID');
 if(!url.username||!url.password)reject('URL_CREDENTIAL_FIELDS_MISSING');
 if(!/^\/[^/]+$/.test(url.pathname))reject('URL_DATABASE_PATH_INVALID');
 if(url.port&&url.port!=='5432')reject('URL_PORT_FORBIDDEN');
 const seen=new Set();
 for(const [key,value]of url.searchParams){
  if(seen.has(key))reject('URL_PARAMETER_DUPLICATE');seen.add(key);
  if(key==='sslmode'){if(!['require','verify-ca','verify-full'].includes(value))reject('URL_SSLMODE_INVALID');}
  else if(key==='channel_binding'){if(value!=='require')reject('URL_CHANNEL_BINDING_INVALID');}
  else reject('URL_PARAMETER_FORBIDDEN');
 }
 if(verdict==='NEON_HOST_INVALID')reject('URL_HOST_INVALID');
 if(verdict==='ENDPOINT_MISMATCH')reject('URL_ENDPOINT_MISMATCH');
 reject('URL_POLICY_REJECTED');
}
