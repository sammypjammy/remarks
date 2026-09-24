import { randomUUID } from 'node:crypto';
import { getPool } from '../auth/database.js';
export class RcStore {
  constructor(pool = getPool(), schema = 'toolkit_rc_v3', authSchema = 'toolkit_auth') {
    if (![schema,authSchema].every(s => /^[a-z_][a-z0-9_]*$/.test(s))) throw new Error('Invalid schema');
    Object.assign(this, { pool, schema, authSchema });
  }
  async transaction(fn) {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
    catch { await c.query('ROLLBACK').catch(() => {}); throw new Error('Connection operation unavailable'); }
    finally { c.release(); }
  }
  async validSession(c, user, session) {
    const r = await c.query(`SELECT s.token_hash FROM ${this.authSchema}.sessions s JOIN ${this.authSchema}.users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active FOR SHARE OF s,u`, [session,user]);
    if (!r.rowCount) throw new Error('Session unavailable');
  }
  async start(user, session, environment, makeTransaction) {
    return this.transaction(async c => {
      await this.validSession(c,user,session);
      await c.query(`INSERT INTO ${this.schema}.connections(id,user_id,environment) VALUES($1,$2,$3) ON CONFLICT(environment,user_id) DO NOTHING`, [randomUUID(),user,environment]);
      const { rows } = await c.query(`UPDATE ${this.schema}.connections SET state='connecting',generation=generation+1,updated_at=now()
        WHERE user_id=$1 AND environment=$2 AND state IN ('disconnected','connecting') AND token_envelope IS NULL RETURNING *`, [user,environment]);
      if (!rows[0]) throw new Error('Disconnect before reconnecting');
      const tx = makeTransaction(rows[0]);
      await c.query(`INSERT INTO ${this.schema}.oauth_transactions
        (state_hash,binding_hash,user_id,session_hash,connection_id,environment,generation,verifier_envelope,redirect_uri)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [tx.state_hash,tx.binding_hash,user,session,rows[0].id,environment,rows[0].generation,tx.verifier_envelope,tx.redirect_uri]);
      return tx;
    });
  }
  async consume(state, binding, user, session, environment, redirectUri) {
    return this.transaction(async c => {
      await this.validSession(c,user,session);
      const { rows } = await c.query(`SELECT t.* FROM ${this.schema}.oauth_transactions t JOIN ${this.schema}.connections r ON r.id=t.connection_id
        WHERE t.state_hash=$1 AND t.binding_hash=$2 AND t.user_id=$3 AND t.session_hash=$4 AND t.environment=$5 AND t.redirect_uri=$6
        AND t.consumed_at IS NULL AND t.expires_at>now() AND t.generation=r.generation AND r.state='connecting' FOR UPDATE OF t,r`,
      [state,binding,user,session,environment,redirectUri]);
      if (!rows[0]) return null;
      await c.query(`UPDATE ${this.schema}.oauth_transactions SET consumed_at=now(),verifier_envelope=NULL WHERE state_hash=$1`,[state]);
      return rows[0];
    });
  }
  async connect(tx, identity, token, envelope) {
    return this.transaction(async c => {
      await this.validSession(c,tx.user_id,tx.session_hash);
      // Persist identity ownership even after tokens are disconnected.
      await c.query(`INSERT INTO ${this.schema}.identities(environment,account_id,extension_id,user_id) VALUES($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`, [tx.environment,identity.accountId,identity.extensionId,tx.user_id]);
      const owned = await c.query(`SELECT user_id FROM ${this.schema}.identities WHERE environment=$1 AND account_id=$2 AND extension_id=$3 AND user_id=$4`,
        [tx.environment,identity.accountId,identity.extensionId,tx.user_id]);
      if (!owned.rowCount) throw new Error('Identity unavailable');
      const r = await c.query(`UPDATE ${this.schema}.connections SET state='connected',generation=generation+1,account_id=$1,extension_id=$2,
        display_name=$3,token_envelope=$4,access_expires_at=$5,refresh_expires_at=$6,scopes=$7,updated_at=now()
        WHERE id=$8 AND user_id=$9 AND environment=$10 AND generation=$11 AND state='connecting' RETURNING id`,
      [identity.accountId,identity.extensionId,identity.displayName,envelope,token.accessExpires,token.refreshExpires,token.scopes,tx.connection_id,tx.user_id,tx.environment,tx.generation]);
      if (!r.rowCount) throw new Error('Stale connection operation');
    });
  }
  async get(user, environment) {
    // An abandoned claim must never cause replay of an old refresh token.
    await this.pool.query(`UPDATE ${this.schema}.connections SET state='needs_reconnect',generation=generation+1,refresh_claim=NULL,refresh_deadline=NULL,updated_at=now()
      WHERE user_id=$1 AND environment=$2 AND state='refreshing' AND refresh_deadline<=now()`, [user,environment]);
    return (await this.pool.query(`SELECT * FROM ${this.schema}.connections WHERE user_id=$1 AND environment=$2`,[user,environment])).rows[0] || null;
  }
  async claim(row) {
    return (await this.pool.query(`UPDATE ${this.schema}.connections SET state='refreshing',refresh_claim=$1,refresh_deadline=now()+interval '20 seconds',updated_at=now()
      WHERE id=$2 AND user_id=$3 AND environment=$4 AND generation=$5 AND state='connected' AND refresh_expires_at>now() RETURNING *`,
    [randomUUID(),row.id,row.user_id,row.environment,row.generation])).rows[0] || null;
  }
  async refreshed(row, token, envelope) {
    const r = await this.pool.query(`UPDATE ${this.schema}.connections SET state='connected',generation=generation+1,token_envelope=$1,
      access_expires_at=$2,refresh_expires_at=$3,scopes=$4,refresh_claim=NULL,refresh_deadline=NULL,updated_at=now()
      WHERE id=$5 AND user_id=$6 AND environment=$7 AND generation=$8 AND state='refreshing' AND refresh_claim=$9 AND refresh_deadline>now()`,
    [envelope,token.accessExpires,token.refreshExpires,token.scopes,row.id,row.user_id,row.environment,row.generation,row.refresh_claim]);
    return r.rowCount === 1;
  }
  async uncertain(row, newEnvelope = null) {
    await this.pool.query(`UPDATE ${this.schema}.connections SET state='needs_reconnect',generation=generation+1,refresh_claim=NULL,refresh_deadline=NULL,updated_at=now()
      WHERE id=$1 AND user_id=$2 AND environment=$3 AND
        (generation=$4 OR ($5::jsonb IS NOT NULL AND generation=$4::bigint+1 AND token_envelope=$5::jsonb))
        AND state IN ('connected','refreshing')`, [row.id,row.user_id,row.environment,row.generation,newEnvelope]);
  }
  async disconnect(user, environment) {
    // Do not race provider revocation against an in-flight refresh. The caller retries.
    await this.get(user,environment);
    return (await this.pool.query(`UPDATE ${this.schema}.connections SET state='disconnecting',generation=generation+1,
      refresh_claim=NULL,refresh_deadline=NULL,updated_at=now() WHERE user_id=$1 AND environment=$2 AND state<>'refreshing' RETURNING *`, [user,environment])).rows[0] || null;
  }
  async disconnected(row) {
    const r = await this.pool.query(`UPDATE ${this.schema}.connections SET state='disconnected',token_envelope=NULL,access_expires_at=NULL,
      refresh_expires_at=NULL,scopes=NULL,display_name=NULL,updated_at=now()
      WHERE id=$1 AND user_id=$2 AND environment=$3 AND generation=$4 AND state='disconnecting'`,[row.id,row.user_id,row.environment,row.generation]);
    return r.rowCount === 1;
  }
}
