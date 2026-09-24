import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const browserPath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('Fax v3 desktop/mobile: contacts, batches, receipts, history, legacy disposal and employee changes',{skip:!browserPath,timeout:90000},async t=>{
  let employee='A',signedIn=true,sendCount=0,receiptCount=0,holdSend=false,releaseSend,holdContacts=false,releaseContacts;
  const histories={A:[],B:[]},requests=[];
  const server=createServer(async(req,res)=>{
    const path=req.url.split('?')[0];res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    if(path==='/api/auth/session'){res.statusCode=signedIn?200:401;return res.end(JSON.stringify(signedIn?{authenticated:true,user:{displayName:'Employee '+employee}}:{authenticated:false}));}
    if(path==='/api/auth/logout'){signedIn=false;return res.end('{}');}
    if(path==='/api/ringcentral/connection')return res.end(JSON.stringify({state:'connected',displayName:'Employee '+employee,accountId:'827653020',extensionId:employee==='A'?'12345':'67890'}));
    if(path==='/api/fax-v3/context'){res.statusCode=signedIn?200:401;return res.end(JSON.stringify({state:'connected',context:(employee==='A'?'a':'b').repeat(64)}));}
    if(path.startsWith('/api/fax-v3/')){
      const owner=employee;assert.equal(req.headers['x-toolkit-fax-context'],(owner==='A'?'a':'b').repeat(64));requests.push(path);
      if(path.endsWith('/history'))return res.end(JSON.stringify({entries:histories[owner].slice(0,20)}));
      if(path.endsWith('/contacts')){
        if(holdContacts)await new Promise(r=>releaseContacts=r);
        if(req.method==='POST')return res.end(JSON.stringify({contacts:{id:'2',name:'New Contact',numbers:['+442079460000']}}));
        return res.end(JSON.stringify({contacts:[{id:'1',name:'Contact '+owner,company:'',numbers:['+18015551234']}]}));
      }
      if(path.endsWith('/send')){
        sendCount++;const chunks=[];for await(const chunk of req)chunks.push(chunk);const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':req.headers['content-type']}}).formData();
        assert.equal(form.get('lastFour'),'0012');assert.equal(form.get('includeCoverSheet'),'true');assert.equal(form.getAll('file').length,1);assert.equal(form.get('coverPageText'),'synthetic comment');
        if(holdSend)await new Promise(r=>releaseSend=r);
        const entry={faxId:randomUUID(),filename:form.get('file').name,lastFour:form.get('lastFour'),recipientName:form.get('recipientName'),faxNumber:form.get('faxNumber'),createdAt:new Date().toISOString(),status:'Sent',retryable:false,tracking:false,accessible:true};histories[owner].unshift(entry);return res.end(JSON.stringify(entry));
      }
      if(path.endsWith('/receipt')){receiptCount++;res.setHeader('Content-Type','application/pdf');return res.end('%PDF-synthetic');}
      res.statusCode=404;return res.end('{}');
    }
    const name=path==='/fax-sender-v3/'?'index.html':path.split('/').pop();
    if(!['index.html','test.js','app.js','client.js','style.css'].includes(name)){res.statusCode=404;return res.end();}
    res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL('../development/fax-sender-v3/'+name,import.meta.url)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const origin='http://127.0.0.1:'+server.address().port;
  const profile=await mkdtemp(join(tmpdir(),'fax-v3-page-'));const files=[join(profile,'Brief.pdf'),join(profile,'Second.pdf')];for(const file of files)await writeFile(file,'%PDF-synthetic');
  const browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let socket;t.after(async()=>{releaseSend?.();releaseContacts?.();socket?.close();browser.kill();await pause(500);assert.equal(dirname(resolve(profile)),resolve(tmpdir()));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
  let port;for(let i=0;i<100&&!port;i++){port=await readFile(join(profile,'DevToolsActivePort'),'utf8').then(s=>s.split('\n')[0]).catch(()=>null);if(!port)await pause(100);}assert(port);
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
  const pending=new Map();let id=0;socket.onmessage=({data})=>{const e=JSON.parse(data);if(!pending.has(e.id))return;const p=pending.get(e.id);pending.delete(e.id);e.error?p.reject(Error('Browser protocol failed')):p.resolve(e.result);};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const ev=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails);return r.result.value;};
  const until=async expression=>{for(let i=0;i<200;i++){if(await ev(expression))return;await pause(50);}assert.fail('Browser condition: '+expression);};
  await cdp('Page.setDownloadBehavior',{behavior:'deny'});
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('packard.faxHistory.v1','PRIVATE LEGACY CANARY')"});
  const choose=async()=>{const {root}=await cdp('DOM.getDocument');const {nodeId}=await cdp('DOM.querySelector',{nodeId:root.nodeId,selector:'#pdfFiles'});await cdp('DOM.setFileInputFiles',{nodeId,files});await until("document.querySelectorAll('#documents li').length===2");};
  for(const width of [1280,390]){
    employee='A';signedIn=true;histories.A=[];histories.B=[];
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await cdp('Page.navigate',{url:origin+'/fax-sender-v3/'});
    await until("document.getElementById('faxWorkspace')&&!document.getElementById('faxWorkspace').hidden");assert(await ev("localStorage.length===0 && sessionStorage.length===0 && !document.body.textContent.includes('PRIVATE LEGACY')"));
    await ev("document.getElementById('loadContacts').click()");await pause(200);assert.equal(await ev("document.getElementById('contactNotice').textContent"),'1 fax contacts loaded.');await until("document.querySelector('#contactResults button')");await ev("document.querySelector('#contactResults button').click()");
    assert.equal(await ev("document.getElementById('destination').value"),'+18015551234');
    await ev("document.getElementById('clearDestination').click()");assert(await ev("document.getElementById('destination').value==='' && document.activeElement.id==='destination'"));
    await ev("document.getElementById('destination').value='+18015551234';document.getElementById('cover').click()");assert(await ev("document.getElementById('commentField').hidden"));await ev("document.getElementById('cover').click()");
    await choose();assert.equal(await ev("document.getElementById('documentCount').textContent"),'PDF documents (2)');
    await ev("[...document.querySelectorAll('#documents li:first-child button')].find(b=>b.textContent==='Move down').click()");assert(await ev("document.activeElement===document.querySelectorAll('#documents li')[1]"));
    assert(await ev("document.documentElement.scrollWidth<=innerWidth && document.querySelector('h1').textContent==='Fax Sender'"));
    const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(tmpdir(),'fax-v3-polish-'+width+'.png'),Buffer.from(shot.data,'base64'));
    const before=sendCount;await ev("document.getElementById('lastFour').value='123';document.getElementById('send').click()");await pause(150);assert.equal(sendCount,before);
    await ev("document.getElementById('lastFour').value='0012';document.getElementById('comment').value='synthetic comment';document.getElementById('send').click()");
    await until("document.querySelectorAll('#faxHistory li').length===2 && document.getElementById('progress').textContent===''");assert.equal(sendCount,before+2);
    assert(await ev("document.getElementById('destination').disabled && document.getElementById('lastFour').disabled && !document.querySelector('#faxHistory details[open]')"));
    await ev("document.getElementById('downloadZip').click()");await until("document.getElementById('receiptNotice').textContent.includes('2 receipt(s)')");assert(receiptCount>=2);
    await ev("document.getElementById('clear').click()");await until("document.querySelectorAll('#documents li').length===0");assert.equal(await ev("document.querySelectorAll('#faxHistory li').length"),2);
    await ev("document.getElementById('destination').value='+442079460000';document.getElementById('contactName').value='New Contact';document.getElementById('createContact').click()");await until("document.getElementById('contactNotice').textContent==='Contact saved and selected.'");
    await cdp('Page.reload');await until("document.querySelectorAll('#faxHistory li').length===2 && !document.getElementById('loadContacts').disabled");
    holdContacts=true;await ev("document.getElementById('loadContacts').click()");for(let i=0;i<100&&!releaseContacts;i++)await pause(20);assert(releaseContacts);
    employee='B';await ev("document.getElementById('refresh').click()");await until("document.getElementById('toolkitState').textContent==='Signed in as Employee B' && document.querySelectorAll('#faxHistory li').length===0");holdContacts=false;releaseContacts();releaseContacts=null;await pause(150);
    assert(await ev("!document.getElementById('contactResults').textContent.includes('Contact A') && document.querySelectorAll('#documents li').length===0 && document.documentElement.scrollWidth<=innerWidth"));
    await choose();holdSend=true;const n=sendCount;await ev("document.getElementById('destination').value='+18015551234';document.getElementById('lastFour').value='0012';document.getElementById('comment').value='synthetic comment';document.getElementById('send').click()");
    for(let i=0;i<100&&!releaseSend;i++)await pause(20);assert(releaseSend);await ev("document.getElementById('signOut').click()");await until("document.getElementById('faxWorkspace').hidden");holdSend=false;releaseSend();releaseSend=null;await pause(1200);assert.equal(sendCount,n+1);
    assert(await ev("document.querySelectorAll('#documents li').length===0 && document.querySelectorAll('#faxHistory li').length===0 && localStorage.length===0 && sessionStorage.length===0"));
  }
  assert(requests.every(path=>path.startsWith('/api/fax-v3/')));
});
