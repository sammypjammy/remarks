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
test('Fax v3 desktop/mobile: responsive polish, connection placement, contacts, batches, receipts, history and employee changes',{skip:!browserPath,timeout:90000},async t=>{
  let employee='A',signedIn=true,connectionState='connected',connectionFailure=false,sendCount=0,receiptCount=0,holdSend=false,releaseSend,holdContacts=false,releaseContacts,holdSession=false,releaseSession;
  const histories={A:[],B:[]},requests=[],receiptIds=[];
  const server=createServer(async(req,res)=>{
    const path=req.url.split('?')[0];res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    if(path==='/api/auth/session'){if(holdSession)await new Promise(r=>releaseSession=r);res.statusCode=signedIn?200:401;return res.end(JSON.stringify(signedIn?{authenticated:true,user:{displayName:'Employee '+employee}}:{authenticated:false}));}
    if(path==='/api/auth/logout'){signedIn=false;return res.end('{}');}
    if(path==='/api/ringcentral/connection'){if(connectionFailure){res.statusCode=502;return res.end('{}');}return res.end(JSON.stringify({state:connectionState,displayName:'Employee '+employee,accountId:'827653020',extensionId:employee==='A'?'12345':'67890'}));}
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
        const entry={faxId:randomUUID(),batchId:form.get('batchId'),filename:form.get('file').name,lastFour:form.get('lastFour'),recipientName:form.get('recipientName'),faxNumber:form.get('faxNumber'),createdAt:new Date().toISOString(),status:'Sent',retryable:false,tracking:false,accessible:true};histories[owner].unshift(entry);return res.end(JSON.stringify(entry));
      }
      if(path.endsWith('/receipt')){receiptCount++;receiptIds.push(new URL(req.url,origin).searchParams.get('faxId'));res.setHeader('Content-Type','application/pdf');return res.end('%PDF-synthetic');}
      res.statusCode=404;return res.end('{}');
    }
    if(path.startsWith('/settings/shared/')){
      const shared=path.slice('/settings/shared/'.length);
      if(!['favicon.png','style.css','footer.css','settings-storage.js','app-shell.js','toolkit-auth.css','toolkit-auth.js'].includes(shared)){res.statusCode=404;return res.end();}
      res.setHeader('Content-Type',shared.endsWith('.js')?'text/javascript':shared.endsWith('.css')?'text/css':'image/png');return res.end(await readFile(new URL('../settings/shared/'+shared,import.meta.url)));
    }
    const name=path==='/fax-sender/'?'index.html':path.split('/').pop();
    if(!['index.html','test.js','app.js','client.js','style.css'].includes(name)){res.statusCode=404;return res.end();}
    res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL('../fax-sender/'+name,import.meta.url)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const origin='http://127.0.0.1:'+server.address().port;
  const profile=await mkdtemp(join(tmpdir(),'fax-v3-page-'));const files=[join(profile,'Brief.pdf'),join(profile,'Second.pdf')];for(const file of files)await writeFile(file,'%PDF-synthetic');
  const browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let socket;t.after(async()=>{releaseSend?.();releaseContacts?.();releaseSession?.();socket?.close();browser.kill();await pause(500);assert.equal(dirname(resolve(profile)),resolve(tmpdir()));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});});
  let port;for(let i=0;i<100&&!port;i++){port=await readFile(join(profile,'DevToolsActivePort'),'utf8').then(s=>s.split('\n')[0]).catch(()=>null);if(!port)await pause(100);}assert(port);
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
  const pending=new Map();let id=0;socket.onmessage=({data})=>{const e=JSON.parse(data);if(!pending.has(e.id))return;const p=pending.get(e.id);pending.delete(e.id);e.error?p.reject(Error('Browser protocol failed')):p.resolve(e.result);};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const ev=async expression=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails);return r.result.value;};
  const until=async expression=>{for(let i=0;i<200;i++){if(await ev(expression))return;await pause(50);}assert.fail('Browser condition: '+expression);};
  await cdp('Page.enable');
  await cdp('Page.setDownloadBehavior',{behavior:'deny'});
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('packard.faxHistory.v1','PRIVATE LEGACY CANARY')"});
  const choose=async()=>{const {root}=await cdp('DOM.getDocument');const {nodeId}=await cdp('DOM.querySelector',{nodeId:root.nodeId,selector:'#pdfFiles'});await cdp('DOM.setFileInputFiles',{nodeId,files});await until("document.querySelectorAll('#documents li').length===2");};
  for(const width of [1280,390]){
    employee='A';signedIn=true;histories.A=[];histories.B=[];
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await cdp('Page.navigate',{url:origin+'/fax-sender/'});
    await until("document.getElementById('faxWorkspace')&&!document.getElementById('faxWorkspace').hidden");assert(await ev("localStorage.getItem('packard.faxHistory.v1')==='PRIVATE LEGACY CANARY' && ![...Object.keys(localStorage)].some(key=>/fax-v3|ringcentral/i.test(key)) && sessionStorage.length===0 && !document.body.textContent.includes('PRIVATE LEGACY') && document.getElementById('accountId').hidden"));
    assert(await ev("document.getElementById('accountStatus').parentElement.id==='accountStatusBottom' && !document.getElementById('accountStatusBottom').hidden && !document.getElementById('identity').hidden && !document.getElementById('refresh').hidden && !document.getElementById('disconnect').hidden"),'Healthy connected status retains identity and secondary actions at page bottom');
    assert(await ev("(()=>{const d=document.querySelector('.destination-number-field').getBoundingClientRect(),l=document.querySelector('.last-four-field').getBoundingClientRect(),di=document.getElementById('destination').getBoundingClientRect(),li=document.getElementById('lastFour').getBoundingClientRect(),a=document.querySelector('.field-actions').getBoundingClientRect(),g=document.querySelector('.destination-action-buttons').getBoundingClientRect(),c=document.querySelector('.cover-toggle').getBoundingClientRect(),r=document.querySelector('.destination-recipient-row').getBoundingClientRect();return innerWidth>=641?Math.abs(d.top-l.top)<1&&di.width>li.width*2&&li.width<=100&&a.top>=r.bottom-1&&Math.abs(a.left-r.left)<1&&Math.abs(g.top-c.top)<1&&c.left>=g.right:l.top>=d.bottom&&a.top>=r.bottom-1&&Math.abs(a.left-r.left)<1&&g.left===a.left&&c.top>=g.top&&c.right<=a.right+1})()"),'Destination, Last 4, grouped destination actions, and cover toggle align and wrap responsively');
    assert(await ev("document.querySelector('.field-actions #cover') && document.querySelector('.cover-options #commentField') && document.getElementById('lastFour').required && !document.querySelector('.last-four-field label').innerText.includes('required') && !document.body.innerText.includes('Clearing the composer preserves this history.') && !document.body.innerText.includes('Used for history and receipt filenames only.')"),'Cover control remains wired beside destination actions, Last 4 stays required without helper copy');
    assert(await ev("(()=>{const t=document.body.innerText;return !['Choose a destination','US numbers may use 10 digits. International numbers need + and country code.','Up to 1,024 characters','Newest 20 attempts','New selections are added to the list','Retry is only available','Retry is available only','Send PDFs from your own RingCentral extension.'].some(s=>t.includes(s))})()"),'Requested helper copy is absent');
    const themes=await ev("(()=>{const root=document.documentElement,values={};for(const theme of ['light','dark','sepia','forest']){root.dataset.theme=theme;const style=getComputedStyle(root);values[theme]=style.getPropertyValue('--page-bg').trim();if(theme==='dark'&&style.colorScheme!=='dark')return null;}root.dataset.theme='light';return values})()");assert(themes,'Dark mode keeps its dark color scheme');assert.equal(new Set(Object.values(themes)).size,4,'All shared themes retain distinct Fax Sender page surfaces');
    if(width===1280){for(const state of ['disconnected','connecting','needs_reconnect','disconnecting']){connectionState=state;await ev("document.getElementById('refresh').click()");await until(`document.getElementById('connectionState').textContent==='${({disconnected:'Not connected. Connect your own RingCentral account.',connecting:'A connection attempt is pending. You can try Connect again or disconnect to cancel it.',needs_reconnect:'Reconnect required. Disconnect first, then connect your RingCentral account again.',disconnecting:'Disconnect is pending. Retry Disconnect to finish revoking access.'})[state]}'`);assert(await ev("document.getElementById('accountStatus').parentElement.id==='accountStatusTop' && document.getElementById('accountStatusBottom').hidden"),`${state} connection remains prominent`);}connectionState='connected';await ev("document.getElementById('refresh').click()");await until("document.getElementById('accountStatus').parentElement.id==='accountStatusBottom'");connectionFailure=true;await ev("document.getElementById('refresh').click()");await until("document.getElementById('toolkitState').textContent==='Toolkit sign-in is unavailable or has changed.'");assert(await ev("document.getElementById('accountStatus').parentElement.id==='accountStatusTop' && document.getElementById('signIn').getClientRects().length>0"),'Connection errors and required sign-in remain prominent');connectionFailure=false;await ev("document.getElementById('refresh').click()");await until("document.getElementById('accountStatus').parentElement.id==='accountStatusBottom'");}
    if(width===1280){
      holdSession=true;await ev("window.dispatchEvent(new Event('focus'))");for(let i=0;i<100&&!releaseSession;i++)await pause(20);assert(releaseSession);
      assert(await ev("document.getElementById('toolkitState').textContent==='Signed in as Employee A' && !document.getElementById('identity').hidden && !document.getElementById('faxWorkspace').hidden"));
      holdSession=false;const release=releaseSession;releaseSession=null;release();await pause(150);
      const queued={faxId:randomUUID(),filename:'Existing.pdf',lastFour:'0012',recipientName:'Controlled recipient',faxNumber:'+18015551234',createdAt:new Date().toISOString(),status:'Queued',retryable:false,tracking:true,accessible:true};histories.A=[queued];const beforePoll=sendCount;
      await cdp('Page.reload');await until("document.querySelectorAll('#faxHistory li').length===1");await until("document.getElementById('faxNotice').textContent.includes('Fax status could not be refreshed')");
      assert.equal(sendCount,beforePoll);assert.equal(histories.A[0].status,'Queued');assert.equal(histories.A[0].retryable,false);
      histories.A=[];await cdp('Page.reload');await until("document.querySelectorAll('#faxHistory li').length===0 && !document.getElementById('faxWorkspace').hidden");
    }
    await ev("document.getElementById('loadContacts').click()");await pause(200);assert.equal(await ev("document.getElementById('contactNotice').textContent"),'1 fax contacts loaded.');await until("document.querySelector('#contactResults button')");await ev("document.querySelector('#contactResults button').click()");
    assert.equal(await ev("document.getElementById('destination').value"),'+18015551234');
    await ev("document.getElementById('clearDestination').click()");assert(await ev("document.getElementById('destination').value==='' && document.activeElement.id==='destination'"));
    await ev("document.getElementById('destination').value='+18015551234';document.getElementById('cover').click()");assert(await ev("(()=>{const options=document.getElementById('coverOptions'),destination=document.querySelector('.destination-section').getBoundingClientRect(),documents=document.querySelector('.documents-section').getBoundingClientRect(),gap=parseFloat(getComputedStyle(document.getElementById('faxFields')).rowGap);return !document.getElementById('cover').checked&&options.hidden&&options.getClientRects().length===0&&document.getElementById('commentField').hidden&&Math.abs((documents.top-destination.bottom)-gap)<1})()"),'Turning cover sheet off hides its whole panel and closes the surrounding grid gap');await ev("document.getElementById('cover').click()");assert(await ev("(()=>{const options=document.getElementById('coverOptions');return document.getElementById('cover').checked&&!options.hidden&&options.getClientRects().length>0&&!document.getElementById('commentField').hidden&&document.getElementById('comment').value===''})()"),'Turning cover sheet on restores the full section without changing its fields');
    await choose();assert.equal(await ev("document.getElementById('documentCount').textContent"),'PDF documents (2)');
    await ev("[...document.querySelectorAll('#documents li:first-child button')].find(b=>b.textContent==='Move down').click()");assert(await ev("document.activeElement===document.querySelectorAll('#documents li')[1]"));
    await ev("document.querySelector('#documents li button').click()");assert.equal(await ev("document.querySelectorAll('#documents li').length"),1,'PDF remove action updates the batch');await choose();assert.equal(await ev("document.querySelectorAll('#documents li').length"),2,'PDF selection can refill the batch');
    assert(await ev("document.documentElement.scrollWidth<=innerWidth && document.querySelector('h1').textContent==='Fax Sender'"));
    assert(await ev("(()=>{const root=document.documentElement,panel=document.querySelector('.composer-panel');root.dataset.theme='light';const light=getComputedStyle(panel).backgroundColor;root.dataset.theme='dark';return light!==getComputedStyle(panel).backgroundColor&&getComputedStyle(root).colorScheme==='dark'})()"));await ev("document.documentElement.dataset.theme='light'");
    const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(tmpdir(),'fax-v3-polish-'+width+'.png'),Buffer.from(shot.data,'base64'));
    const before=sendCount;await ev("document.getElementById('lastFour').value='123';document.getElementById('send').click()");await pause(150);assert.equal(sendCount,before);
    await ev("document.getElementById('lastFour').value='0012';document.getElementById('comment').value='synthetic comment';document.getElementById('send').click()");
    await until("document.querySelectorAll('#faxHistory li').length===2 && document.getElementById('progress').textContent===''");assert.equal(sendCount,before+2);
    assert(await ev("document.getElementById('destination').disabled && document.getElementById('lastFour').disabled && !document.querySelector('#faxHistory details[open]') && document.querySelectorAll('#faxHistory .status.sent').length===2"));
    const historyShot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(tmpdir(),'fax-v3-polish-history-'+width+'.png'),Buffer.from(historyShot.data,'base64'));
    const firstBatch=histories.A[0].batchId;assert(firstBatch);assert.equal(new Set(histories.A.slice(0,2).map(entry=>entry.batchId)).size,1,'One send run shares one batch ID');
    await ev("document.getElementById('clear').click()");await until("document.querySelectorAll('#documents li').length===0");await choose();await ev("document.getElementById('destination').value='+18015551234';document.getElementById('lastFour').value='0012';document.getElementById('comment').value='synthetic comment';document.getElementById('send').click()");await until("document.querySelectorAll('#faxHistory li').length===4 && document.getElementById('progress').textContent==='' ");
    const newestBatch=histories.A[0].batchId;assert(newestBatch);assert.notEqual(newestBatch,firstBatch,'Separate send runs receive different batch IDs');assert.equal(new Set(histories.A.slice(0,2).map(entry=>entry.batchId)).size,1);
    histories.A[0]={...histories.A[0],status:'SendingFailed',retryable:true};await cdp('Page.reload');await until("document.querySelectorAll('#faxHistory li').length===4 && document.querySelectorAll('#faxHistory .status.failed').length===1 && document.querySelectorAll('#faxHistory .status.sent').length===3 && !document.getElementById('downloadAll').disabled");
    const beforeRecent=receiptIds.length;await ev("document.getElementById('downloadAll').click()");await until("document.getElementById('receiptNotice').textContent.includes('1 receipt(s)')");assert.deepEqual(receiptIds.slice(beforeRecent),[histories.A[1].faxId],'Download all receipts selects only Sent receipts in the newest batch');
    const beforeZip=receiptIds.length;await ev("document.getElementById('downloadZip').click()");await until("document.getElementById('receiptNotice').textContent.includes('3 receipt(s)')");assert.deepEqual(new Set(receiptIds.slice(beforeZip)),new Set(histories.A.filter(entry=>entry.status==='Sent').map(entry=>entry.faxId)),'Download ZIP still includes all available Sent history receipts');
    await ev("document.getElementById('clear').click()");await until("document.querySelectorAll('#documents li').length===0");assert.equal(await ev("document.querySelectorAll('#faxHistory li').length"),4);
    await ev("document.getElementById('destination').value='+442079460000';document.getElementById('contactName').value='New Contact';document.getElementById('createContact').click()");await until("document.getElementById('contactNotice').textContent==='Contact saved and selected.'");
    await cdp('Page.reload');await until("document.querySelectorAll('#faxHistory li').length===4 && document.querySelectorAll('#faxHistory .status.sent').length===3 && !document.getElementById('loadContacts').disabled");const beforeReloadedBatch=receiptIds.length;await ev("document.getElementById('downloadAll').click()");await until("document.getElementById('receiptNotice').textContent.includes('1 receipt(s)')");assert.deepEqual(receiptIds.slice(beforeReloadedBatch),[histories.A[1].faxId],'Reloaded history preserves newest-batch grouping');
    holdContacts=true;await ev("document.getElementById('loadContacts').click()");for(let i=0;i<100&&!releaseContacts;i++)await pause(20);assert(releaseContacts);
    employee='B';await ev("document.getElementById('refresh').click()");await until("document.getElementById('toolkitState').textContent==='Signed in as Employee B' && document.querySelectorAll('#faxHistory li').length===0");holdContacts=false;releaseContacts();releaseContacts=null;await pause(150);
    assert(await ev("!document.getElementById('contactResults').textContent.includes('Contact A') && document.querySelectorAll('#documents li').length===0 && document.documentElement.scrollWidth<=innerWidth"));
    await choose();holdSend=true;const n=sendCount;await ev("document.getElementById('destination').value='+18015551234';document.getElementById('lastFour').value='0012';document.getElementById('comment').value='synthetic comment';document.getElementById('send').click()");
    for(let i=0;i<100&&!releaseSend;i++)await pause(20);assert(releaseSend);await ev("document.getElementById('signOut').click()");await until("document.getElementById('faxWorkspace').hidden");holdSend=false;releaseSend();releaseSend=null;await pause(1200);assert.equal(sendCount,n+1);
    assert(await ev("document.querySelectorAll('#documents li').length===0 && document.querySelectorAll('#faxHistory li').length===0 && document.getElementById('accountStatus').parentElement.id==='accountStatusTop' && localStorage.getItem('packard.faxHistory.v1')==='PRIVATE LEGACY CANARY' && ![...Object.keys(localStorage)].some(key=>/fax-v3|ringcentral/i.test(key)) && sessionStorage.length===0"));
  }
  assert(requests.every(path=>path.startsWith('/api/fax-v3/')));
});
