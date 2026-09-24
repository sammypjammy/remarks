import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const numeric = value => /^[1-9][0-9]{0,29}$/.test(String(value));
export const e164 = value => typeof value === 'string' && /^\+[1-9]\d{6,14}$/.test(value);
export function fail(status = 409) { throw Object.assign(new Error('Fax operation unavailable'), { status }); }
export function contextFor(row, session, config) {
  return createHmac('sha256',config.keys.get(config.activeKey)).update(JSON.stringify([
    'fax-v3-context',config.environment,row.user_id,session,row.id,String(row.generation),row.account_id,row.extension_id
  ])).digest('hex');
}
export function checkContext(row, user, session, context, config) {
  if (!row || row.state !== 'connected' || row.user_id !== user || row.environment !== config.environment ||
      row.account_id !== config.accountId || !numeric(row.extension_id) || !/^[a-f0-9]{64}$/.test(context || '')) fail();
  if (!timingSafeEqual(Buffer.from(context),Buffer.from(contextFor(row,session,config)))) fail();
}
export function metadataContext(row) { return ['fax-metadata',row.environment,row.user_id,row.connection_id,row.account_id,row.extension_id,row.id]; }
export const safeStatus = status => status === 'Sending' || status === 'Processing' ? 'Processing' : ['Queued','Sent','SendingFailed'].includes(status) ? status : 'Unknown';
export const stateOf = status => status === 'Sent' ? 'sent' : status === 'SendingFailed' ? 'failed' : ['Queued','Sending','Processing'].includes(status) ? 'accepted' : 'unknown';
export const publicState = row => row.state === 'sent' ? 'Sent' : row.state === 'failed' ? 'SendingFailed' : row.state === 'accepted' && new Date(row.tracking_deadline).getTime()>Date.now() ? (row.provider_status==='Processing'?'Processing':'Queued') : 'Unknown';
export function text(value, limit, optional = false) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f\u007f]/.test(value) || (!optional && !value.trim())) fail(400);
  return value.trim();
}
export function validateSubmission(fields, pdf) {
  const allowed = ['faxNumber','filename','lastFour','recipientName','includeCoverSheet','coverPageText','idempotencyKey','retryOf'];
  if (Object.keys(fields).some(k=>!allowed.includes(k)) || !uuid(fields.idempotencyKey) ||
      (fields.retryOf && !uuid(fields.retryOf)) || !e164(fields.faxNumber) || !/^\d{4}$/.test(fields.lastFour || '') ||
      typeof fields.includeCoverSheet !== 'boolean') fail(400);
  const filename=text(fields.filename,255), recipientName=text(fields.recipientName || '',200,true);
  if (!/\.pdf$/i.test(filename) || !Buffer.isBuffer(pdf) || pdf.length<5 || pdf.length>4000000 || pdf.subarray(0,5).toString()!=='%PDF-') fail(400);
  if (typeof fields.coverPageText !== 'string') fail(400);
  const comment=fields.coverPageText.replace(/\r\n?/g,'\n').trim();
  if(comment.length>1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(comment))fail(400);
  const payload={to:[{phoneNumber:fields.faxNumber,...(recipientName?{name:recipientName}:{})}],faxResolution:'High',coverIndex:fields.includeCoverSheet?5:0};
  if(fields.includeCoverSheet && comment)payload.coverPageText=comment;
  const metadata={filename,lastFour:fields.lastFour,recipientName,faxNumber:fields.faxNumber};
  const requestHash=createHash('sha256').update(JSON.stringify([metadata,payload])).update(pdf).digest('hex');
  return {metadata,payload,pdf,requestHash,idempotencyKey:fields.idempotencyKey,retryOf:fields.retryOf || null};
}
export function receiptFilename(filename,lastFour) {
  if(!/^\d{4}$/.test(lastFour))fail();
  const base=filename.replace(/(?:\.pdf)+$/i,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\s+/g,' ').trim().slice(0,180) || 'Document';
  return `Fax Receipt - ${base} ${lastFour}.pdf`;
}
