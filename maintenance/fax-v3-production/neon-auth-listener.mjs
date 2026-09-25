import http from 'node:http';
import {syncBuiltinESMExports} from 'node:module';
import {timingSafeEqual} from 'node:crypto';

export const AUTH_PROGRESS=Object.freeze([
 'NEON_CLI_CALLBACK_LISTENING_60_SECOND_WINDOW',
 'NEON_CLI_CALLBACK_IGNORED',
 'NEON_CLI_CALLBACK_RECEIVED',
 'NEON_CLI_AUTH_CREDENTIALS_SAVED'
]);
export const AUTH_FAILURES=Object.freeze([
 'NEON_CLI_AUTH_TIMEOUT',
 'NEON_CLI_AUTH_LISTENER_FAILED',
 'NEON_CLI_AUTH_BROWSER_FAILED',
 'NEON_CLI_AUTH_CALLBACK_REJECTED',
 'NEON_CLI_AUTH_TOKEN_EXCHANGE_FAILED',
 'NEON_CLI_AUTH_KEYRING_FAILED',
 'NEON_CLI_AUTH_NETWORK_FAILED',
 'NEON_CLI_AUTH_PROCESS_FAILED'
]);

// Never return any part of an upstream message; classification has a fixed vocabulary.
export function authFailure(message) {
 if(/Authentication timed out/.test(message))return 'NEON_CLI_AUTH_TIMEOUT';
 if(/Failed to open web browser/.test(message))return 'NEON_CLI_AUTH_BROWSER_FAILED';
 if(/keyring|Failed to save credentials/.test(message))return 'NEON_CLI_AUTH_KEYRING_FAILED';
 if(/NEON_REQUEST_REFUSED|Could not reach|Request timed out/.test(message))return 'NEON_CLI_AUTH_NETWORK_FAILED';
 return 'NEON_CLI_AUTH_PROCESS_FAILED';
}

export function callbackDecision({method,host,url,port,state,pending=false}) {
 try {
  if(typeof url!=='string'||url.length>16384||method!=='GET'||host!==`127.0.0.1:${port}`)return 'IGNORE';
  const request=new URL(url,`http://127.0.0.1:${port}`);
  if(request.origin!==`http://127.0.0.1:${port}`||request.pathname!=='/callback'||request.hash||!state)return 'IGNORE';
  const received=request.searchParams.getAll('state');
  if(received.length!==1)return 'IGNORE';
  const expected=Buffer.from(state),actual=Buffer.from(received[0]);
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return 'IGNORE';
  const codes=request.searchParams.getAll('code'),errors=request.searchParams.getAll('error');
  if(errors.length===1&&errors[0]&&codes.length===0)return pending?'IGNORE':'DENIED';
  if(codes.length!==1||!codes[0]||errors.length!==0||pending)return 'IGNORE';
  return 'ACCEPT';
 }catch{return 'IGNORE';}
}

// Neon 6.1.0's callback handler launches an async handler without catching its
// rejection. A /callback probe (missing/wrong state/code) otherwise kills the
// whole CLI before the real browser returns. Keep the official OAuth flow and
// verifier; reject unsolicited requests before they enter that handler.
export async function installAuthListener() {
 const {log}=await import('./node_modules/neon/dist/log.js');
 const original=http.createServer;
 const servers=new Set();
 let expectedState,expectedPort,pending=false,response,stopping=false,finished=false;
 const emit=value=>process.stderr.write(value+'\n');
 const reply=(res,status)=>{if(!res.headersSent)res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(status===400?'This callback does not complete the active Neon CLI sign-in.':'Not found.');};
 const stop=code=>{
  if(stopping)return;stopping=true;emit(code);
  if(response&&!response.writableEnded)reply(response,400);
  for(const server of servers)server.close();
  // Give a fixed error response a moment to flush, never retain a dead listener.
  setTimeout(()=>process.exit(1),100);
 };
 http.createServer=function(...args){
  const server=Reflect.apply(original,this,args);servers.add(server);
  const originalEmit=server.emit;
  server.on('error',()=>stop('NEON_CLI_AUTH_LISTENER_FAILED'));
  server.on('close',()=>servers.delete(server));
  server.emit=function(event,...values){
   if(event==='request'){
    const [req,res]=values;
    const port=server.address()?.port;
    const decision=callbackDecision({method:req.method,host:req.headers.host,url:req.url,port,state:port===expectedPort?expectedState:undefined,pending});
    if(decision==='IGNORE'){if(!finished&&req.url?.startsWith('/callback'))emit('NEON_CLI_CALLBACK_IGNORED');reply(res,400);return true;}
    response=res;
    if(decision==='DENIED'){stop('NEON_CLI_AUTH_CALLBACK_REJECTED');return true;}
    pending=true;emit('NEON_CLI_CALLBACK_RECEIVED');
   }
   return Reflect.apply(originalEmit,this,[event,...values]);
  };
  return server;
 };
 syncBuiltinESMExports();
 // The official CLI supplies its own authorization URL. Keep only its transient
 // CSRF state and loopback port in this subprocess. Never print/forward the URL.
 log.debug=()=>{};
 log.info=(message)=>{
  if(typeof message==='string'&&message.startsWith('Auth Url: ')){
   try{
    const auth=new URL(message.slice('Auth Url: '.length));
    const callback=new URL(auth.searchParams.get('redirect_uri'));
    const state=auth.searchParams.get('state');
    if(auth.origin!=='https://oauth2.neon.tech'||callback.hostname!=='127.0.0.1'||callback.protocol!=='http:'||callback.pathname!=='/callback'||!state||auth.searchParams.getAll('state').length!==1)throw Error();
    const port=Number(callback.port);
    if(![...servers].some(s=>s.listening&&s.address()?.address==='127.0.0.1'&&s.address()?.port===port))throw Error();
    expectedState=state;expectedPort=port;
    emit('NEON_CLI_CALLBACK_LISTENING_60_SECOND_WINDOW');
   }catch{stop('NEON_CLI_AUTH_LISTENER_FAILED');}
  }else if(message==='Auth complete'){finished=true;emit('NEON_CLI_AUTH_CREDENTIALS_SAVED');}
 };
 log.warning=()=>{};
 log.error=message=>emit(authFailure(String(message)));
 // Do not allow an upstream exception to print a callback URL, authorization
 // code, token response or stack. Official validation still fails closed.
 process.on('unhandledRejection',()=>stop(pending?'NEON_CLI_AUTH_TOKEN_EXCHANGE_FAILED':'NEON_CLI_AUTH_PROCESS_FAILED'));
 process.on('uncaughtException',()=>stop(pending?'NEON_CLI_AUTH_TOKEN_EXCHANGE_FAILED':'NEON_CLI_AUTH_PROCESS_FAILED'));
}
