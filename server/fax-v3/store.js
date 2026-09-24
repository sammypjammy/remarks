import { randomUUID } from 'node:crypto';
import { RcStore } from '../ringcentral-v3/store.js';
import { encrypt, decrypt } from '../ringcentral-v3/crypto.js';
import { checkContext, fail, metadataContext, publicState, uuid } from './safety.js';
export class FaxStore extends RcStore {
  async transaction(fn) {
    const c=await this.pool.connect();
    try { await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result; }
    catch(error) { await c.query('ROLLBACK').catch(()=>{});fail([400,401,403,404,409].includes(error.status)?error.status:503); }
    finally { c.release(); }
  }
  async locked(ctx,fn) {
    return this.transaction(async c=>{
      await this.validSession(c,ctx.user,ctx.session);
      const row=(await c.query(`SELECT * FROM ${this.schema}.connections WHERE user_id=$1 AND environment=$2 FOR SHARE`,[ctx.user,ctx.config.environment])).rows[0];
      checkContext(row,ctx.user,ctx.session,ctx.context,ctx.config);
      return fn(c,row);
    });
  }
  async owned(c,ctx,id,connection) {
    if(!uuid(id))fail(404);
    const row=(await c.query(`SELECT * FROM ${this.schema}.fax_attempts WHERE id=$1 AND user_id=$2 AND environment=$3`,[id,ctx.user,ctx.config.environment])).rows[0];
    if(!row || row.connection_id!==connection.id || row.account_id!==connection.account_id || row.extension_id!==connection.extension_id)fail(404);
    return row;
  }
  public(row,config) {
    const metadata=decrypt(row.metadata_envelope,metadataContext(row),config);
    return {faxId:row.id,filename:metadata.filename,lastFour:metadata.lastFour,recipientName:metadata.recipientName,faxNumber:metadata.faxNumber,
      createdAt:new Date(row.created_at).toISOString(),status:publicState(row),retryable:row.state==='failed',
      tracking:!!row.message_id && !['sent','failed'].includes(row.state) && new Date(row.tracking_deadline).getTime()>Date.now()};
  }
  async reserve(ctx,input) {
    return this.locked(ctx,async(c,connection)=>{
      // Serialize reservations for this employee; duplicates never make a second call.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ctx.config.environment+ctx.user]);
      const prior=(await c.query(`SELECT * FROM ${this.schema}.fax_attempts WHERE user_id=$1 AND environment=$2 AND idempotency_key=$3`,[ctx.user,ctx.config.environment,input.idempotencyKey])).rows[0];
      if(prior) { if(prior.request_hash!==input.requestHash)fail();return {row:prior,fresh:false}; }
      if(input.retryOf) {
        const previous=await this.owned(c,ctx,input.retryOf,connection);
        if(previous.state!=='failed' || previous.request_hash!==input.requestHash)fail();
      }
      const row={id:randomUUID(),user_id:ctx.user,connection_id:connection.id,environment:ctx.config.environment,account_id:connection.account_id,extension_id:connection.extension_id};
      const metadata=encrypt(input.metadata,metadataContext(row),ctx.config);
      const result=await c.query(`INSERT INTO ${this.schema}.fax_attempts
        (id,user_id,connection_id,environment,account_id,extension_id,idempotency_key,request_hash,state,metadata_envelope,tracking_deadline,connection_generation,retry_of)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'submitting',$9,now()+interval '15 minutes',$10,$11) RETURNING *`,
        [row.id,row.user_id,row.connection_id,row.environment,row.account_id,row.extension_id,input.idempotencyKey,input.requestHash,metadata,connection.generation,input.retryOf]);
      return {row:result.rows[0],fresh:true};
    });
  }
  async history(ctx) {
    return this.locked(ctx,async(c,connection)=>{
      const rows=(await c.query(`SELECT * FROM ${this.schema}.fax_attempts WHERE user_id=$1 AND environment=$2 ORDER BY created_at DESC,id DESC LIMIT 20`,[ctx.user,ctx.config.environment])).rows;
      return rows.map(row=>({...this.public(row,ctx.config),accessible:row.connection_id===connection.id && row.account_id===connection.account_id && row.extension_id===connection.extension_id}));
    });
  }
  async markUnknown(ctx,id) {
    // No provider call here. Never turn a proven terminal result into unknown.
    await this.pool.query(`UPDATE ${this.schema}.fax_attempts SET state='unknown',updated_at=now() WHERE id=$1 AND user_id=$2 AND environment=$3 AND state='submitting'`,[id,ctx.user,ctx.config.environment]);
  }
}
