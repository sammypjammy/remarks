import { e164, fail, numeric, text } from './safety.js';
const BASE='https://platform.ringcentral.com';
export class FaxProvider {
  constructor(request=fetch) { this.request=request; }
  path(row) {
    if(!numeric(row.account_id)||!numeric(row.extension_id))fail();
    return `/restapi/v1.0/account/${row.account_id}/extension/${row.extension_id}`;
  }
  async response(path,token,options={}) {
    const r=await this.request(BASE+path,{...options,headers:{...options.headers,Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok)fail(503);return r;
  }
  async bytes(response,max) {
    const reader=response.body.getReader();const parts=[];let length=0;
    try { for(;;) { const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max)fail(503);parts.push(Buffer.from(value)); } }
    finally { await reader.cancel().catch(()=>{}); }
    return Buffer.concat(parts);
  }
  async json(path,token,options) {
    const r=await this.response(path,token,options);return JSON.parse((await this.bytes(r,4*1024*1024)).toString('utf8'));
  }
  async send(row,token,input) {
    const body=new FormData();body.append('json',new Blob([JSON.stringify(input.payload)],{type:'application/json'}));
    body.append('attachment',new Blob([input.pdf],{type:'application/pdf'}),'document.pdf');
    const data=await this.json(this.path(row)+'/fax',token,{method:'POST',body});
    if(!numeric(data.id))fail(503);
    return {messageId:String(data.id),status:typeof data.messageStatus==='string'?data.messageStatus:'Unknown'};
  }
  async message(row,token) {
    if(!numeric(row.message_id))fail();
    const data=await this.json(this.path(row)+'/message-store/'+row.message_id,token);
    if(String(data.id)!==row.message_id || data.type!=='Fax' || data.direction!=='Outbound')fail(503);
    return data;
  }
  async receipt(row,token) {
    const data=await this.message(row,token);
    if(data.messageStatus!=='Sent' || !Array.isArray(data.attachments))fail();
    const attachment=data.attachments.find(a=>a.type==='RenderedDocument' && a.contentType==='application/pdf' && numeric(a.id));
    if(!attachment)fail();
    // Build the documented content path from the owned message and its member
    // attachment. Never follow a provider-supplied URI or a redirect.
    const r=await this.response(this.path(row)+'/message-store/'+row.message_id+'/content/'+attachment.id,token);
    if(r.status!==200 || r.headers.get('content-type')?.split(';')[0].trim()!=='application/pdf')fail(503);
    const bytes=await this.bytes(r,10*1024*1024);if(bytes.subarray(0,5).toString()!=='%PDF-')fail(503);return bytes;
  }
  async contacts(row,token) {
    const contacts=[];const seen=new Set();let records=0;const deadline=Date.now()+30000;
    for(let page=1;page<=100;page++) {
      if(Date.now()>deadline)fail(503);
      const data=await this.json(this.path(row)+`/address-book/contact?perPage=1000&page=${page}`,token);
      const total=data.paging?.totalPages,perPage=data.paging?.perPage;
      if(!Array.isArray(data.records) || (total!=null && (!Number.isInteger(total)||total<0||total>100)) ||
          (data.paging?.page!=null && data.paging.page!==page) || (perPage!=null && (!Number.isInteger(perPage)||perPage<1||perPage>1000)))fail(503);
      records+=data.records.length;if(records>10000)fail(503);
      for(const item of data.records) {
        if(!item || ['Deleted','Purged'].includes(item.availability) || !numeric(item.id))continue;
        const numbers=[...new Set([item.businessFax,item.otherFax].filter(x=>typeof x==='string').map(x=>x.replace(/[\s().-]/g,'')).filter(e164))];if(!numbers.length)continue;
        const name=[item.firstName,item.middleName,item.lastName].filter(x=>typeof x==='string').join(' ').trim() || (typeof item.nickName==='string'?item.nickName:'') || (typeof item.company==='string'?item.company:'') || 'Contact';
        if(seen.has(String(item.id)))continue;seen.add(String(item.id));
        contacts.push({id:String(item.id),name:String(name).slice(0,200),company:typeof item.company==='string'?item.company.slice(0,200):'',numbers});
        if(contacts.length>10000)fail(503);
      }
      const hasNext=!!data.navigation?.nextPage || (total!=null?page<total:data.records.length===(perPage || 1000));
      if(!hasNext)return contacts;
      if(!data.records.length)fail(503);
    }
    fail(503);
  }
  async createContact(row,token,input) {
    if(Object.keys(input).some(k=>!['name','faxNumber'].includes(k)) || !e164(input.faxNumber))fail(400);
    const name=text(input.name,60);const existing=(await this.contacts(row,token)).find(c=>c.numbers.includes(input.faxNumber));
    if(existing)return existing;
    const data=await this.json(this.path(row)+'/address-book/contact',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:name,businessFax:input.faxNumber})});
    if(!numeric(data.id))fail(503);return {id:String(data.id),name,company:'',numbers:[input.faxNumber]};
  }
}
