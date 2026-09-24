import {Scope,Batch,Poller,number,formatNumber,receiptFilename,receiptZip,wait} from './client.js';
const $=id=>document.getElementById(id);
let batch,poller,entries=[],contacts=[],selectedName='',signedIn=false,syncing=false,historySequence=0,receiptBusy=false,contactBusy=false;
const objectUrls=new Set();
const note=message=>{$('faxNotice').textContent=message;};
const scope=new Scope(fetch,()=>{
  historySequence++;entries=[];contacts=[];selectedName='';receiptBusy=false;contactBusy=false;poller?.clear();batch?.clear();
  for(const url of objectUrls)URL.revokeObjectURL(url);objectUrls.clear();
  $('faxForm').reset();$('contactResults').replaceChildren();$('faxHistory').replaceChildren();$('contactNotice').textContent='';$('receiptNotice').textContent='';$('faxWorkspace').hidden=true;
});
const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
function action(label,fn) {const b=element('button',label);b.type='button';b.addEventListener('click',fn);return b;}
function render() {
  if(!batch)return;
  const busy=batch.running||batch.adding,locked=batch.locked;
  for(const id of ['destination','clearDestination','lastFour','cover','comment','loadContacts','contactName','createContact'])$(id).disabled=locked||busy;
  $('commentField').hidden=!$('cover').checked;$('documentCount').textContent='PDF documents'+(batch.documents.length?' ('+batch.documents.length+')':'');$('comment').disabled ||= !$('cover').checked;$('pdfFiles').disabled=busy;
  $('send').disabled=busy||!batch.documents.some(d=>d.state==='Ready');$('retry').disabled=busy||!batch.documents.some(d=>d.entry?.retryable);
  $('clear').disabled=busy;$('progress').textContent=batch.running?'Sending one PDF at a time. Do not resend an unconfirmed fax.':batch.adding?'Checking PDFs…':'';
  $('documents').replaceChildren(...batch.documents.map((doc,index)=>{
    const li=element('li'),title=element('strong',doc.file.name);li.tabIndex=-1;li.append(title,element('p',doc.state));
    if(doc.state==='Ready'&&!busy) {
      li.append(action('Remove',()=>{batch.documents.splice(index,1);render();($('documents').children[Math.min(index,batch.documents.length-1)]||$('pdfFiles')).focus();}));
      if(index>0)li.append(action('Move up',()=>{[batch.documents[index-1],batch.documents[index]]=[doc,batch.documents[index-1]];render();$('documents').children[index-1].focus();}));
      if(index<batch.documents.length-1)li.append(action('Move down',()=>{[batch.documents[index+1],batch.documents[index]]=[doc,batch.documents[index+1]];render();$('documents').children[index+1].focus();}));
    }
    if(doc.entry){poller?.track(doc.entry);if(doc.entry.status==='Sent')li.append(action('Download Fax Receipt',()=>download([doc.entry],false)));}
    if(doc.state==='Unknown')li.append(element('p','Outcome unknown. Review RingCentral before taking further action. Automatic retry is disabled.'));
    return li;
  }));
}
batch=new Batch(scope,()=>{render();if(scope.context)void historyRefresh();});
function renderHistory() {
  const open=new Set([...$('faxHistory').querySelectorAll('details[open]')].map(d=>d.dataset.id));
  $('historyEmpty').hidden=entries.length>0;
  $('faxHistory').replaceChildren(...entries.map(entry=>{
    const li=element('li'),d=element('details');d.dataset.id=entry.faxId;d.open=open.has(entry.faxId);
    const summary=element('summary');summary.append(element('strong',entry.filename+' '+entry.lastFour),element('p',`${entry.recipientName || formatNumber(entry.faxNumber)} · ${new Date(entry.createdAt).toLocaleString()}`));
    const status=element('span',entry.status==='SendingFailed'?'Error — SendingFailed':entry.status);status.className='status '+(entry.status==='Sent'?'sent':entry.status==='SendingFailed'?'error':'');summary.append(status);d.append(summary,element('p','Destination: '+formatNumber(entry.faxNumber)));
    if(entry.status==='Unknown')d.append(element('p','Unconfirmed outcome. Review RingCentral; do not automatically resend.'));
    if(entry.status==='Sent'&&entry.accessible!==false)d.append(action('Download Fax Receipt',()=>download([entry],false)));
    li.append(d);return li;
  }));
  const any=entries.some(e=>e.status==='Sent'&&e.accessible!==false);
  $('downloadAll').disabled=receiptBusy||!any;$('downloadZip').disabled=receiptBusy||!any;
}
async function historyRefresh() {
  const sequence=++historySequence,epoch=scope.epoch;
  try{const data=await scope.api('history');if(sequence!==historySequence||epoch!==scope.epoch)return;
    if(!Array.isArray(data.entries))throw Error();entries=data.entries.slice(0,20);for(const entry of entries)if(entry.accessible!==false)poller.track(entry);renderHistory();
  }catch{if(epoch===scope.epoch)note('History unavailable. Do not resend an unconfirmed fax.');}
}
poller=new Poller(scope,entry=>{
  for(const doc of batch.documents)if(doc.entry?.faxId===entry.faxId){doc.entry=entry;doc.state=entry.status;}
  entries=entries.map(e=>e.faxId===entry.faxId?{...e,...entry}:e);render();renderHistory();
});
async function sync() {
  if(syncing||!signedIn)return;syncing=true;const epoch=scope.epoch;
  try {
    const r=await fetch('/api/fax-v3/context',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(15000)}),data=await r.json();
    if(epoch!==scope.epoch)return;
    if(!r.ok || data.state!=='connected' || !/^[a-f0-9]{64}$/.test(data.context||'')){scope.reset();return;}
    const changed=scope.context!==data.context,previous=scope.context;scope.set(data.context);$('faxWorkspace').hidden=false;
    if(changed){if(previous)note('Session or RingCentral authorization changed. The queue and selected files were cleared. Review history before starting again.');await historyRefresh();}render();
  }catch{if(epoch===scope.epoch){scope.reset();note('Authorization status unavailable. Work stopped; refresh status before continuing.');}}
  finally{syncing=false;}
}
window.addEventListener('toolkit-rc-state',event=>{signedIn=event.detail==='connected';if(signedIn)void sync();else scope.reset();});
window.addEventListener('toolkit-rc-reset',()=>{signedIn=false;scope.reset();});
window.addEventListener('pagehide',()=>{signedIn=false;scope.reset();});
window.addEventListener('beforeunload',event=>{if(batch.running){event.preventDefault();event.returnValue='';}});
setInterval(()=>{if(!document.hidden)void sync();},5000);setInterval(()=>void poller.tick(),1000);
function contactResults() {
  const search=$('destination').value.toLowerCase().replace(/\s+/g,' ');
  const found=contacts.filter(c=>[c.name,c.company,...c.numbers].join(' ').toLowerCase().includes(search));
  $('contactResults').replaceChildren(...found.slice(0,30).flatMap(c=>c.numbers.map(n=>action(c.name+' — '+formatNumber(n),()=>{if(batch.locked||batch.running)return;$('destination').value=n;selectedName=c.name;$('contactResults').replaceChildren();}))));
}
$('clearDestination').addEventListener('click',()=>{if(batch.locked||batch.running)return;$('destination').value='';selectedName='';$('contactResults').replaceChildren();$('destination').focus();});
$('destination').addEventListener('keydown',event=>{if(event.key==='Escape')$('contactResults').replaceChildren();});
$('destination').addEventListener('input',()=>{selectedName='';contactResults();});
$('loadContacts').addEventListener('click',async()=>{
  if(contactBusy||batch.locked)return;contactBusy=true;const epoch=scope.epoch;$('contactNotice').textContent='Loading your contacts…';
  try {const data=await scope.api('contacts');if(epoch!==scope.epoch)return;contacts=data.contacts;contactResults();$('contactNotice').textContent=contacts.length+' fax contacts loaded.';}
  catch{if(epoch===scope.epoch)$('contactNotice').textContent='Contacts unavailable. You may enter a fax number manually.';}
  finally{if(epoch===scope.epoch)contactBusy=false;}
});
$('createContact').addEventListener('click',async()=>{
  if(contactBusy||batch.locked)return;const faxNumber=number($('destination').value),name=$('contactName').value.trim();
  if(!faxNumber||!name){$('contactNotice').textContent='Enter a valid fax number and contact name.';return;}
  const epoch=scope.epoch;contactBusy=true;$('createContact').disabled=true;
  try{const data=await scope.api('contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,faxNumber})});if(epoch!==scope.epoch)return;
    const c=data.contacts;contacts=[c,...contacts.filter(x=>x.id!==c.id)];selectedName=c.name;$('destination').value=c.numbers[0];$('contactNotice').textContent='Contact saved and selected.';$('saveContact').open=false;
  }catch{if(epoch===scope.epoch)$('contactNotice').textContent='Contact creation could not be confirmed. Refresh contacts before trying again.';}
  finally{if(epoch===scope.epoch){contactBusy=false;render();}}
});
$('cover').addEventListener('change',render);
$('pdfFiles').addEventListener('change',async()=>{const files=[...$('pdfFiles').files];$('pdfFiles').value='';try{await batch.add(files);note('');}catch{note('Choose valid PDF files no larger than 4 MB.');}});
const settings=()=>({faxNumber:number($('destination').value),lastFour:$('lastFour').value,recipientName:selectedName,includeCoverSheet:$('cover').checked,coverPageText:$('comment').value});
async function send(retry) {note('');try{await batch.run(settings(),retry);}catch{note('Check destination, exactly four Last 4 digits, and the cover comment before sending.');}}
$('faxForm').addEventListener('submit',e=>{e.preventDefault();void send(false);});$('retry').addEventListener('click',()=>void send(true));
$('clear').addEventListener('click',()=>{if(batch.running)return;batch.clear();$('faxForm').reset();selectedName='';$('contactResults').replaceChildren();note('');render();});
function save(blob,filename) {const url=URL.createObjectURL(blob),a=element('a');objectUrls.add(url);a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>{URL.revokeObjectURL(url);objectUrls.delete(url);},60000);}
async function download(list,zip) {
  if(receiptBusy)return;const epoch=scope.epoch;receiptBusy=true;renderHistory();$('receiptNotice').textContent='Preparing receipts…';
  let count=0;const receipts=[];
  try {for(const entry of list){const blob=await scope.api('receipt?faxId='+encodeURIComponent(entry.faxId));if(epoch!==scope.epoch)return;if(blob.type!=='application/pdf')throw Error();
      const filename=receiptFilename(entry.filename,entry.lastFour);if(zip)receipts.push({blob,filename});else save(blob,filename);count++;if(!zip)await wait(400);
    }
    if(zip){const blob=await receiptZip(receipts);if(epoch!==scope.epoch)return;save(blob,'Fax Receipts.zip');}
    if(epoch===scope.epoch)$('receiptNotice').textContent=count+' receipt(s) downloaded. Your browser may ask to allow multiple downloads.';
  }catch{if(epoch===scope.epoch)$('receiptNotice').textContent='Receipt download unavailable. Sent status is unchanged. Retry the download; do not resend the fax.';}
  finally{if(epoch===scope.epoch){receiptBusy=false;renderHistory();}}
}
$('downloadAll').addEventListener('click',()=>download(entries.filter(e=>e.status==='Sent'&&e.accessible!==false),false));
$('downloadZip').addEventListener('click',()=>download(entries.filter(e=>e.status==='Sent'&&e.accessible!==false),true));
