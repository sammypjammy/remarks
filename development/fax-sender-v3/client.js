export const wait=ms=>new Promise(r=>setTimeout(r,ms));
export const validLastFour=value=>/^\d{4}$/.test(value);
export function number(value) { let s=value.replace(/[\s().-]/g,'');if(/^\d{10}$/.test(s))s='+1'+s;else if(/^1\d{10}$/.test(s))s='+'+s;return /^\+[1-9]\d{6,14}$/.test(s)?s:''; }
export function formatNumber(value) { return /^\+1\d{10}$/.test(value)?`(${value.slice(2,5)}) ${value.slice(5,8)}-${value.slice(8)}`:value; }
export function receiptFilename(filename,lastFour) { if(!validLastFour(lastFour))throw Error();return `Fax Receipt - ${filename.replace(/(?:\.pdf)+$/i,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\s+/g,' ').trim().slice(0,180)||'Document'} ${lastFour}.pdf`; }
export function disposeLegacy(storage) { try{storage.removeItem('packard.faxHistory.v1');}catch{} }
export class Scope {
  constructor(request=fetch,onReset=()=>{}) {this.request=(...args)=>request(...args);this.onReset=onReset;this.epoch=0;this.context=null;this.controller=new AbortController();}
  reset() {this.epoch++;this.context=null;this.controller.abort();this.controller=new AbortController();this.onReset();}
  set(context) {if(context!==this.context){this.reset();this.context=context;}return this.epoch;}
  async api(path,options={}) {
    const epoch=this.epoch,context=this.context;if(!context)throw Error();
    const r=await this.request('/api/fax-v3/'+path,{...options,headers:{...options.headers,'X-Toolkit-Fax-Context':context},credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(65000)])});
    if(epoch!==this.epoch)throw Error();
    if([401,403,409].includes(r.status)){this.reset();throw Error();}
    if(!r.ok)throw Error();
    const result=path.startsWith('receipt?')?await r.blob():await r.json();if(epoch!==this.epoch)throw Error();
    // Recheck with the current browser cookie before publishing a response from
    // an earlier request. This also fences a session change in another tab.
    let check,current;
    try {check=await this.request('/api/fax-v3/context',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)])});current=await check.json();}
    catch {if(epoch===this.epoch)this.reset();throw Error();}
    if(epoch!==this.epoch)throw Error();
    if(!check.ok || current.state!=='connected' || current.context!==context){this.reset();throw Error();}
    return result;
  }
}
export class Batch {
  constructor(scope,onChange=()=>{},pause=wait) {this.scope=scope;this.onChange=onChange;this.pause=pause;this.clear();}
  clear() {this.documents=[];this.running=false;this.adding=false;this.locked=false;this.snapshot=null;this.onChange();}
  async add(files) {
    const epoch=this.scope.epoch;if(this.running||this.adding)return;this.adding=true;this.onChange();
    try {for(const file of files) {
      if(!/\.pdf$/i.test(file.name) || (file.type && file.type!=='application/pdf') || file.size>4000000 || file.size<5 || await file.slice(0,5).text()!=='%PDF-')throw Error('Choose valid PDFs, up to 4 MB each.');
      if(epoch!==this.scope.epoch)throw Error();
      if(!this.documents.some(d=>d.file.name===file.name && d.file.size===file.size && d.file.lastModified===file.lastModified))this.documents.push({file,state:'Ready',entry:null,idempotencyKey:crypto.randomUUID()});
    }} finally {if(epoch===this.scope.epoch){this.adding=false;this.onChange();}}
  }
  async run(settings,retry=false) {
    if(this.running || this.adding || !this.scope.context)return;
    if(!validLastFour(settings.lastFour) || !number(settings.faxNumber) || settings.coverPageText.trim().length>1024)throw Error('Enter the destination, exactly four Last 4 digits, and a comment of at most 1024 characters.');
    const queue=this.documents.filter(d=>retry?d.entry?.retryable===true:d.state==='Ready');if(!queue.length)return;
    const epoch=this.scope.epoch;this.snapshot ||= Object.freeze({...settings,faxNumber:number(settings.faxNumber),coverPageText:settings.coverPageText.trim()});
    this.locked=true;this.running=true;this.onChange();
    try { for(let i=0;i<queue.length;i++) {
      if(epoch!==this.scope.epoch)break;
      const doc=queue[i],form=new FormData();
      for(const [key,value] of Object.entries(this.snapshot))form.append(key,String(value));
      form.append('file',doc.file,doc.file.name);
      if(retry){form.append('retryOf',doc.entry.faxId);doc.idempotencyKey=crypto.randomUUID();}
      form.append('idempotencyKey',doc.idempotencyKey);doc.state='Submitting';doc.entry=null;this.onChange();
      try { const entry=await this.scope.api('send',{method:'POST',body:form});if(epoch!==this.scope.epoch)break;
        if(typeof entry.faxId!=='string' || !['Queued','Processing','Sent','SendingFailed','Unknown'].includes(entry.status))throw Error();
        doc.entry=entry;doc.state=entry.status;
      } catch {if(epoch!==this.scope.epoch)break;doc.state='Unknown';}
      if(epoch!==this.scope.epoch)break;this.onChange();
      // Ambiguity halts the rest of the batch as well; nothing resumes automatically.
      if(doc.state==='Unknown')break;
      if(i<queue.length-1)await this.pause(1000);
    } } finally {if(epoch===this.scope.epoch){this.running=false;this.onChange();}}
  }
}
export class Poller {
  constructor(scope,update,clock=()=>Date.now()) {this.scope=scope;this.update=update;this.clock=clock;this.pending=new Map();this.busy=false;this.next=0;}
  clear() {this.pending.clear();this.next=0;}
  track(entry) {if(entry.tracking && !this.pending.has(entry.faxId))this.pending.set(entry.faxId,{due:this.clock()+10000,deadline:new Date(entry.createdAt).getTime()+900000});if(!entry.tracking)this.pending.delete(entry.faxId);}
  async tick() {
    const now=this.clock(),epoch=this.scope.epoch;if(this.busy || now<this.next)return;
    for(const [id,p] of this.pending)if(p.deadline<=now)this.pending.delete(id);
    const candidate=[...this.pending].sort((a,b)=>a[1].due-b[1].due).find(([,p])=>p.due<=now);if(!candidate)return;
    const [id,p]=candidate;this.busy=true;
    try {const entry=await this.scope.api('status?faxId='+encodeURIComponent(id));if(epoch!==this.scope.epoch || this.pending.get(id)!==p)return;this.update(entry);if(!entry.tracking)this.pending.delete(id);}
    catch{}finally {p.due=this.clock()+30000;this.next=this.clock()+5000;this.busy=false;}
  }
}
// Stored ZIP entries: no library, PDF recompression, path input or browser storage.
export async function receiptZip(receipts) {
  const chunks=[],central=[];let offset=0;const names=new Set();
  const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  for(const item of receipts) {
    let name=item.filename;for(let i=2;names.has(name);i++)name=i+'/'+item.filename;names.add(name);
    const n=new TextEncoder().encode(name),data=new Uint8Array(await item.blob.arrayBuffer()),sum=crc(data);
    const h=new Uint8Array(30+n.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);h.set(n,30);
    const c=new Uint8Array(46+n.length),w=new DataView(c.buffer);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint32(16,sum,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,n.length,true);w.setUint32(42,offset,true);c.set(n,46);
    chunks.push(h,data);central.push(c);offset+=h.length+data.length;
  }
  const size=central.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,receipts.length,true);v.setUint16(10,receipts.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end],{type:'application/zip'});
}
