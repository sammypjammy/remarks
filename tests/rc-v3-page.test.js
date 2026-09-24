import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {sameOrigin} from '../server/auth/security.js';
const browserPath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('Development OAuth page: signed-out, identity, reconnect, disconnect, errors, mobile and no persistence',{skip:!browserPath,timeout:60000},async t=>{
  let signedIn=false,state='disconnected',error=false,connects=0,disconnects=0,csrfRejected=0;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    const path=req.url.split('?')[0];
    if(path==='/api/auth/session'){res.statusCode=signedIn?200:401;return res.end(JSON.stringify(signedIn?{authenticated:true,user:{displayName:'Synthetic Employee'}}:{authenticated:false}));}
    if(path==='/api/auth/logout'){assert.equal(req.method,'POST');signedIn=false;return res.end('{}');}
    if(path==='/api/ringcentral/connection'){res.statusCode=error?503:200;return res.end(JSON.stringify(error?{error:'private-canary'}:{state,displayName:'<img src=x onerror=alert(1)>',accountId:'827653020',extensionId:'12345'}));}
    if(path==='/api/ringcentral/disconnect'){assert.equal(req.method,'POST');disconnects++;state='disconnected';return res.end('{}');}
    if(path==='/api/ringcentral/connect'){
      assert.equal(req.method,'POST');
      // Exercise the real CSRF gate on the browser-generated request, not a
      // synthetic header. No credentials or request headers enter diagnostics.
      try{sameOrigin(req,{origin});}catch{csrfRejected++;res.writeHead(303,{Location:'/fax-sender-v3/?connection=failed'});return res.end();}
      connects++;state='connected';res.writeHead(303,{Location:'/fax-sender-v3/?connection=connected'});return res.end();
    }
    const file=path==='/fax-sender-v3/'?'index.html':path==='/fax-sender-v3/test.js'?'test.js':null;
    if(!file){res.statusCode=404;return res.end();}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(new URL('../development/fax-sender-v3/'+file,import.meta.url)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port;
  const profile=await mkdtemp(join(tmpdir(),'rc-v3-page-'));
  const browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let socket;t.after(async()=>{socket?.close();browser.kill();await pause(500);assert.equal(dirname(resolve(profile)),resolve(tmpdir()));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
  let port;for(let i=0;i<100&&!port;i++){port=await readFile(join(profile,'DevToolsActivePort'),'utf8').then(s=>s.split('\n')[0]).catch(()=>null);if(!port)await pause(100);}assert(port);
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
  const pending=new Map();let id=0;socket.onmessage=({data})=>{const e=JSON.parse(data);if(!pending.has(e.id))return;const p=pending.get(e.id);pending.delete(e.id);e.error?p.reject(Error('Browser protocol failed')):p.resolve(e.result);};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const ev=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails);return r.result.value;};
  const until=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await pause(50);}assert.fail('Browser condition: '+expression);};
  for(const width of [1280,390]){
    signedIn=false;state='disconnected';error=false;
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:origin+'/fax-sender-v3/'});
    await until("document.getElementById('toolkitState')?.textContent==='Signed out of the Toolkit.'");
    assert(await ev("document.getElementById('connectForm').hidden && !document.getElementById('signIn').hidden"));
    signedIn=true;await ev("document.getElementById('refresh').click()");await until("!document.getElementById('connectForm').hidden");
    await ev("document.getElementById('connect').click()");await until("!document.getElementById('identity').hidden");
    assert.equal(await ev("document.getElementById('accountId').textContent"),'827653020');assert.equal(await ev("document.getElementById('extensionId').textContent"),'12345');
    assert(await ev("!document.querySelector('#rcName img') && location.search==='' && !document.getElementById('disconnect').hidden"));
    state='needs_reconnect';await ev("document.getElementById('refresh').click()");await until("document.getElementById('connectionState').textContent.startsWith('Reconnect required')");assert(await ev("document.getElementById('identity').hidden && document.getElementById('connectForm').hidden"));
    state='disconnecting';await ev("document.getElementById('refresh').click()");await until("document.getElementById('disconnect').textContent==='Retry Disconnect'");
    await ev("document.getElementById('disconnect').click()");await until("!document.getElementById('connectForm').hidden");
    error=true;await ev("document.getElementById('refresh').click()");await until("document.getElementById('connectionState').textContent.startsWith('Connection status unavailable')");assert(await ev("!document.body.textContent.includes('private-canary') && document.getElementById('identity').hidden"));
    error=false;await ev("document.getElementById('signOut').click()");await until("document.getElementById('toolkitState').textContent==='Signed out of the Toolkit.'");
    assert(await ev("localStorage.length===0 && sessionStorage.length===0 && document.documentElement.scrollWidth<=innerWidth"));
  }
  assert.equal(connects,2);assert.equal(disconnects,2);assert.equal(csrfRejected,0);
  // Reproduce the original policy failure and prove the CSRF check remains strict.
  signedIn=true;state='disconnected';await ev("document.getElementById('refresh').click()");await until("!document.getElementById('connectForm').hidden");
  await ev("document.querySelector('meta[name=referrer]').content='no-referrer';document.getElementById('connect').click()");
  await until("document.getElementById('notice').textContent.startsWith('RingCentral connection could not')");
  assert.equal(csrfRejected,1);assert.equal(connects,2);
});
