import { authConfig } from '../auth/config.js';
import { requireToolkitUser } from '../auth/service.js';
import { cookieValue,hash,sameOrigin } from '../auth/security.js';
import { v3Runtime } from '../ringcentral-v3/runtime.js';
import { RcService } from '../ringcentral-v3/service.js';
import { RingCentralProvider } from '../ringcentral-v3/provider.js';
import { FaxStore } from './store.js';
import { FaxService } from './service.js';
import { FaxProvider } from './provider.js';
import { fail,receiptFilename,validateSubmission } from './safety.js';
async function body(req,max) {
  if(Number(req.headers['content-length'])>max)fail(413);
  let size=0;const parts=[];for await(const part of req) {size+=part.length;if(size>max)fail(413);parts.push(part);}return Buffer.concat(parts);
}
export async function upload(req) {
  const type=req.headers['content-type'] || '';if(!/^multipart\/form-data;/i.test(type))fail(400);
  const form=await new Response(await body(req,4032000),{headers:{'Content-Type':type}}).formData();
  const fields={};let pdf;
  for(const key of new Set(form.keys())) {
    if(form.getAll(key).length!==1)fail(400);const value=form.get(key);
    if(key==='file') { if(!value || typeof value==='string' || (value.type && value.type!=='application/pdf'))fail(400);pdf=Buffer.from(await value.arrayBuffer());fields.filename=value.name; }
    else { if(key==='filename' || typeof value!=='string')fail(400);fields[key]=value; }
  }
  if(!['true','false'].includes(fields.includeCoverSheet))fail(400);fields.includeCoverSheet=fields.includeCoverSheet==='true';
  return validateSubmission(fields,pdf);
}
export function createFaxHandler(action,deps={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const config=deps.config || v3Runtime();
      if(config.environment!=='development' && !(config.environment==='production' && config.productionAcceptance===true))fail(404);
      const methods=action==='send'?['POST']:action==='contacts'?['GET','POST']:['GET'];
      if(!methods.includes(req.method)){res.setHeader('Allow',methods.join(', '));fail(405);}
      const auth=deps.authConfig || authConfig();if(auth.origin!==config.origin)fail();
      const user=await (deps.requireUser || requireToolkitUser)(req,{config:auth});
      const session=cookieValue(req,auth.sessionCookie);if(!session)fail(401);
      if(req.method==='POST')sameOrigin(req,config);
      const store=deps.store || new FaxStore();const service=deps.service || new FaxService(config,store,new RcService(config,store,new RingCentralProvider(config)),new FaxProvider());
      const ctx={user:user.id,session:hash(session),context:req.headers['x-toolkit-fax-context'],config};
      if(action==='context')return res.status(200).json(await service.context(ctx.user,ctx.session));
      // Always authorize before reading/parsing uploads or performing work.
      await store.locked(ctx,async()=>{});
      if(action==='history')return res.status(200).json({entries:await store.history(ctx)});
      if(action==='contacts') {
        let input;
        if(req.method==='POST') { if(req.headers['content-type']!=='application/json')fail(400);input=JSON.parse((await body(req,4096)).toString());if(!input || typeof input!=='object' || Array.isArray(input))fail(400); }
        return res.status(200).json({contacts:await service.contacts(ctx,input)});
      }
      if(action==='send')return res.status(200).json(await service.send(ctx,await upload(req)));
      const url=new URL(req.url,config.origin);
      if(url.searchParams.getAll('faxId').length!==1 || [...url.searchParams.keys()].some(k=>k!=='faxId'))fail(400);
      if(!['status','message','receipt'].includes(action))fail(404);
      const result=await service.fax(ctx,url.searchParams.get('faxId'),action==='receipt');
      if(action==='receipt') {
        if(!result.bytes || !result.entry)fail();
        res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(receiptFilename(result.entry.filename,result.entry.lastFour)));
        return res.status(200).end(result.bytes);
      }
      return res.status(200).json(result);
    } catch(error) {
      const status=[400,401,403,404,405,409,413].includes(error.status)?error.status:503;
      return res.status(status).json({error:status===401?'Toolkit sign-in required':status===409?'Connection changed. Review and reload before continuing.':'Fax operation unavailable. Do not resend an unconfirmed fax; review RingCentral first.'});
    }
  };
}
