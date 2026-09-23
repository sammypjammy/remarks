import { randomUUID } from 'node:crypto';
import { getPool } from './database.js';
import { SESSION_SECONDS, TRANSACTION_SECONDS } from './config.js';

export class AuthStore {
  constructor(pool = getPool(), schema = 'toolkit_auth') {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid schema');
    this.pool = pool;
    this.schema = schema;
  }
  async createTransaction(t) {
    await this.pool.query(`INSERT INTO ${this.schema}.oauth_transactions
      (state_hash, provider, purpose, binding_hash, nonce_hash, pkce_verifier, redirect_uri, expires_at)
      VALUES ($1, 'entra', 'login', $2, $3, $4, $5, now() + $6 * interval '1 second')`,
    [t.stateHash, t.bindingHash, t.nonceHash, t.verifier, t.redirectUri, TRANSACTION_SECONDS]);
  }
  async consumeTransaction(stateHash, bindingHash, redirectUri) {
    // One atomic UPDATE prevents two Vercel instances redeeming the same transaction.
    const { rows } = await this.pool.query(`UPDATE ${this.schema}.oauth_transactions
      SET consumed_at = now(), pkce_verifier = NULL
      FROM (SELECT state_hash AS candidate, pkce_verifier AS verifier FROM ${this.schema}.oauth_transactions) old
      WHERE state_hash = $1 AND old.candidate = state_hash AND binding_hash = $2 AND redirect_uri = $3
        AND provider = 'entra' AND purpose = 'login' AND consumed_at IS NULL AND expires_at > now()
      RETURNING nonce_hash, old.verifier AS pkce_verifier`, [stateHash, bindingHash, redirectUri]);
    return rows[0] || null;
  }
  async createSession(identity, tokenHash, previousHash) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`INSERT INTO ${this.schema}.users
        (id, entra_tenant_id, entra_object_id, display_name) VALUES ($1,$2,$3,$4)
        ON CONFLICT (entra_tenant_id, entra_object_id) DO UPDATE
        SET display_name = EXCLUDED.display_name, updated_at = now()
        WHERE ${this.schema}.users.active = true RETURNING id, active`,
      [randomUUID(), identity.tenantId, identity.objectId, identity.displayName]);
      if (!rows[0]?.active) throw Object.assign(new Error('Not authorized'), { status: 403 });
      if (previousHash) await client.query(`UPDATE ${this.schema}.sessions SET revoked_at = now() WHERE token_hash = $1`, [previousHash]);
      await client.query(`INSERT INTO ${this.schema}.sessions (token_hash, user_id, expires_at)
        VALUES ($1,$2,now() + $3 * interval '1 second')`, [tokenHash, rows[0].id, SESSION_SECONDS]);
      await client.query('COMMIT');
      return rows[0].id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async resolveSession(tokenHash) {
    const { rows } = await this.pool.query(`SELECT u.id, u.entra_tenant_id, u.entra_object_id, u.display_name, u.active
      FROM ${this.schema}.sessions s JOIN ${this.schema}.users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [tokenHash]);
    return rows[0] || null;
  }
  async revokeSession(tokenHash) {
    await this.pool.query(`UPDATE ${this.schema}.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash]);
  }
}
