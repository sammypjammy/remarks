// Test-only offline replacements. Never imported by maintenance tooling.
import {registerHooks,createRequire} from 'node:module';
import http,{get} from 'node:http';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'};
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const payload=b64({alg:'RS256',kid:'fixture'})+'.'+b64({iss:'https://oauth2.neon.tech',sub:'synthetic',aud:'neonctl',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300});
const idToken=payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url');
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const store=new Map();let challenge;
const scenario=process.env.FAX_NEON_FIXTURE_SCENARIO;
if(scenario==='timeout'){
 const original=setTimeout;
 globalThis.setTimeout=(fn,delay,...args)=>original(fn,delay===60000?40:delay,...args);
}
if(scenario==='listener-error'){
 const original=http.createServer;
 http.createServer=function(...args){const server=Reflect.apply(original,this,args);server.listen=function(){queueMicrotask(()=>server.emit('error',Error('synthetic-listener-error-canary')));return server;};return server;};
}
globalThis.__neonFixtureEntry=class {
 constructor(service,account){this.key=service+':'+account;}
 getPassword(){return store.get(this.key);}
 setPassword(value){store.set(this.key,value);}
 deletePassword(){return store.delete(this.key);}
};
createRequire(import.meta.url)('../maintenance/fax-v3-production/node_modules/@napi-rs/keyring').Entry=globalThis.__neonFixtureEntry;
globalThis.__neonFixtureOpen=async value=>{
 const args=process.argv.slice(2);
 if(args[0]!=='auth'||!args.includes('--keyring')||args[args.indexOf('--profile')+1]!=='fax-v3-production-preflight'||args.includes('--api-key'))throw Error('FIXTURE_COMMAND_REJECTED');
 const auth=new URL(value);challenge=auth.searchParams.get('code_challenge');
 const callback=new URL(auth.searchParams.get('redirect_uri'));
 callback.searchParams.set('state',auth.searchParams.get('state'));
 callback.searchParams.set('code','synthetic-authorization-code-canary');
 if(scenario==='real-browser'){
  const {default:open}=await import('../maintenance/fax-v3-production/node_modules/open/index.js');
  await open(callback.href);return;
 }
 if(scenario==='early-probe'){
  for(const path of ['/callback','/callback?code=unsolicited','/callback?state=wrong&code=unsolicited','/favicon.ico']){
   await new Promise(resolve=>get(new URL(path,callback),r=>{r.resume();r.on('end',resolve);}).on('error',resolve));
  }
 }
 if(scenario==='denied'){callback.searchParams.delete('code');callback.searchParams.set('error','access_denied');callback.searchParams.set('error_description','synthetic-error-description-canary');}
 setTimeout(()=>{
  get(callback,r=>{r.resume();r.on('end',()=>process.stderr.write(r.statusCode===200?'FIXTURE_CALLBACK_OK\n':'FIXTURE_CALLBACK_BAD\n'));}).on('error',()=>process.stderr.write('FIXTURE_CALLBACK_REFUSED\n'));
 },250);
};
registerHooks({resolve(specifier,context,next){
 if(specifier==='open'&&context.parentURL?.endsWith('/neon/dist/auth.js'))return {url:'data:text/javascript,export default globalThis.__neonFixtureOpen',shortCircuit:true};
 return next(specifier,context);
}});
globalThis.fetch=async(input,init={})=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.href==='https://oauth2.neon.tech/.well-known/openid-configuration')return json({issuer:'https://oauth2.neon.tech',authorization_endpoint:'https://oauth2.neon.tech/auth',token_endpoint:'https://oauth2.neon.tech/token',jwks_uri:'https://oauth2.neon.tech/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256']});
 if(url.href==='https://oauth2.neon.tech/jwks')return json({keys:[jwk]});
 if(url.href==='https://oauth2.neon.tech/token'){
  if(scenario==='token-error')return new Response(JSON.stringify({error:'invalid_grant',error_description:'synthetic-token-response-canary'}),{status:400,headers:{'content-type':'application/json'}});
  const body=new URLSearchParams(init.body);
  if(body.get('code')!=='synthetic-authorization-code-canary'||createHash('sha256').update(body.get('code_verifier')||'').digest('base64url')!==challenge)throw Error('FIXTURE_PKCE_REJECTED');
  return json({access_token:'synthetic-access-token-canary',refresh_token:'synthetic-refresh-token-canary',token_type:'Bearer',expires_in:300,id_token:idToken});
 }
 if(url.href==='https://console.neon.tech/api/v2/users/me')return json({id:'synthetic',email:'fixture@example.invalid'});
 throw Error('FIXTURE_NETWORK_REFUSED');
};
