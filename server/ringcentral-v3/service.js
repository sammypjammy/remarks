import { randomToken, hash, challenge } from '../auth/security.js';
import { encrypt, decrypt, tokenContext, transactionContext } from './crypto.js';
export class RcService {
  constructor(config, store, provider, pause = ms => new Promise(r => setTimeout(r,ms))) { Object.assign(this,{config,store,provider,pause}); }
  async connect(user, session) {
    const state = randomToken(), binding = randomToken(), verifier = randomToken();
    await this.store.start(user,session,this.config.environment,row => {
      const tx = { state_hash: hash(state), binding_hash: hash(binding), user_id: user, session_hash: session,
        connection_id: row.id, environment: this.config.environment, redirect_uri: this.config.redirectUri };
      tx.verifier_envelope = encrypt({ verifier },transactionContext(tx),this.config); return tx;
    });
    return { binding, url: this.provider.authorizationUrl(state,challenge(verifier)) };
  }
  async callback(user, session, state, binding, code) {
    const tx = await this.store.consume(hash(state),hash(binding),user,session,this.config.environment,this.config.redirectUri);
    if (!tx) throw new Error('Authorization transaction unavailable');
    const { verifier } = decrypt(tx.verifier_envelope,transactionContext(tx),this.config);
    let token;
    try {
      token = await this.provider.exchange(code,verifier);
      const identity = await this.provider.identity(token);
      const row = { id: tx.connection_id, user_id: user, environment: tx.environment, account_id: identity.accountId, extension_id: identity.extensionId };
      const envelope = encrypt({ accessToken: token.accessToken, refreshToken: token.refreshToken },tokenContext(row),this.config);
      await this.store.connect(tx,identity,token,envelope);
    } catch {
      if (token) await this.provider.revoke(token.refreshToken).catch(() => {});
      throw new Error('Connection unavailable');
    }
  }
  async status(user) {
    const row = await this.store.get(user,this.config.environment);
    return { state: row?.state || 'disconnected', ...(row?.state === 'connected' ? {
      displayName: row.display_name, accountId: row.account_id, extensionId: row.extension_id
    } : {}) };
  }
  async accessToken(user) {
    for (let i=0;i<8;i++) {
      const row = await this.store.get(user,this.config.environment);
      if (!row || !['connected','refreshing'].includes(row.state)) throw new Error('Reconnect required');
      if (row.user_id !== user || row.environment !== this.config.environment || row.account_id !== this.config.accountId) throw new Error('Connection ownership unavailable');
      if (row.state === 'refreshing') { await this.pause(150); continue; }
      let tokens;
      try { tokens = decrypt(row.token_envelope,tokenContext(row),this.config);
        if (typeof tokens.accessToken !== 'string' || !tokens.accessToken || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken) throw new Error();
      } catch { await this.store.uncertain(row); throw new Error('Reconnect required'); }
      if (new Date(row.access_expires_at).getTime()>Date.now()+60000) return tokens.accessToken;
      if (new Date(row.refresh_expires_at).getTime()<=Date.now()) { await this.store.uncertain(row); throw new Error('Reconnect required'); }
      const claimed = await this.store.claim(row);
      if (!claimed) continue;
      let token, envelope;
      try {
        token = await this.provider.refresh(tokens.refreshToken);
        if (token.ownerId && token.ownerId !== row.extension_id) throw new Error();
        envelope = encrypt({ accessToken: token.accessToken, refreshToken: token.refreshToken },tokenContext(row),this.config);
        if (!await this.store.refreshed(claimed,token,envelope)) throw new Error();
        return token.accessToken;
      } catch {
        await this.store.uncertain(claimed,envelope);
        // Never replay a refresh or restore a stale generation, even after a lost COMMIT response.
        if (token) await this.provider.revoke(token.refreshToken).catch(() => {});
        throw new Error('Reconnect required');
      }
    }
    throw new Error('Authorization busy');
  }
  async disconnect(user) {
    const existing = await this.store.get(user,this.config.environment);
    if (!existing) return;
    const row = await this.store.disconnect(user,this.config.environment);
    if (!row) throw new Error('Authorization busy; retry disconnect');
    if (row.token_envelope) {
      const tokens = decrypt(row.token_envelope,tokenContext(row),this.config);
      await this.provider.revoke(tokens.refreshToken);
    }
    if (!await this.store.disconnected(row)) throw new Error('Connection changed');
  }
}
