import { contextFor, fail, stateOf, safeStatus } from './safety.js';
export class FaxService {
  constructor(config,store,rc,provider) { Object.assign(this,{config,store,rc,provider}); }
  async context(user,session) {
    let row=await this.store.get(user,this.config.environment);
    if(row?.state==='connected') { await this.rc.accessToken(user);row=await this.store.get(user,this.config.environment); }
    if(!row || row.state!=='connected')return {state:row?.state || 'disconnected'};
    if(row.user_id!==user || row.account_id!==this.config.accountId)fail();
    return {state:'connected',context:contextFor(row,session,this.config),displayName:row.display_name,accountId:row.account_id,extensionId:row.extension_id};
  }
  async operation(ctx,fn) {
    // Ownership/context is checked before token access or any provider request.
    await this.store.locked(ctx,async()=>{});
    const token=await this.rc.accessToken(ctx.user);
    // A refresh increments generation: stop this operation, never silently switch
    // a queued batch to the new context. Explicit user action is needed afterward.
    return this.store.locked(ctx,(c,row)=>fn(c,row,token));
  }
  async send(ctx,input) {
    const reservation=await this.store.reserve(ctx,input);
    if(!reservation.fresh)return this.store.public(reservation.row,this.config);
    const id=reservation.row.id;
    try {
      return await this.operation(ctx,async(c,connection,token)=>{
        const row=await this.store.owned(c,ctx,id,connection);
        if(row.state!=='submitting' || String(row.connection_generation)!==String(connection.generation))fail();
        const result=await this.provider.send(connection,token,input);
        const updated=await c.query(`UPDATE ${this.store.schema}.fax_attempts SET message_id=$1,state=$2,provider_status=$5,updated_at=now() WHERE id=$3 AND user_id=$4 AND state='submitting' RETURNING *`,[result.messageId,stateOf(result.status),id,ctx.user,safeStatus(result.status)]);
        if(!updated.rows[0])fail();return this.store.public(updated.rows[0],this.config);
      });
    } catch {
      await this.store.markUnknown(ctx,id).catch(()=>{});
      // Includes lost COMMIT acknowledgement. The client must not resend.
      return {...this.store.public(reservation.row,this.config),status:'Unknown',retryable:false,tracking:false};
    }
  }
  async contacts(ctx,input) { return this.operation(ctx,(_c,row,token)=>input?this.provider.createContact(row,token,input):this.provider.contacts(row,token)); }
  async fax(ctx,id,receipt=false) {
    // Reject guessed/foreign identifiers before even a refresh request.
    await this.store.locked(ctx,(c,row)=>this.store.owned(c,ctx,id,row));
    return this.operation(ctx,async(c,connection,token)=>{
      const row=await this.store.owned(c,ctx,id,connection);
      if(!row.message_id)return this.store.public(row,this.config);
      if(receipt) { if(row.state!=='sent')fail();return {bytes:await this.provider.receipt(row,token),entry:this.store.public(row,this.config)}; }
      if(['sent','failed'].includes(row.state) || new Date(row.tracking_deadline).getTime()<=Date.now())return this.store.public(row,this.config);
      const message=await this.provider.message(row,token);
      const updated=await c.query(`UPDATE ${this.store.schema}.fax_attempts SET state=$1,provider_status=$4,updated_at=now() WHERE id=$2 AND user_id=$3 AND state NOT IN ('sent','failed') RETURNING *`,[stateOf(message.messageStatus),id,ctx.user,safeStatus(message.messageStatus)]);
      return this.store.public(updated.rows[0] || row,this.config);
    });
  }
}
