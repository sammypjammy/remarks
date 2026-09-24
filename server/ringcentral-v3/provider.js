import { numericId } from './config.js';
const BASE = 'https://platform.ringcentral.com';
export class RingCentralProvider {
  constructor(config, request = fetch) { this.config = config; this.request = request; }
  authorizationUrl(state, challenge) {
    return BASE + '/restapi/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256' });
  }
  async token(body) {
    const response = await this.request(BASE + '/restapi/oauth/token', { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Basic ' + Buffer.from(this.config.clientId + ':' + this.config.clientSecret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Provider authorization unavailable');
    const t = await response.json();
    if (typeof t.access_token !== 'string' || !t.access_token || t.access_token.length > 16000 ||
        typeof t.refresh_token !== 'string' || !t.refresh_token || t.refresh_token.length > 16000 ||
        String(t.token_type).toLowerCase() !== 'bearer' ||
        !Number.isFinite(t.expires_in) || t.expires_in <= 60 ||
        !Number.isFinite(t.refresh_token_expires_in) || t.refresh_token_expires_in <= 0 || typeof t.scope !== 'string') throw new Error('Provider authorization unavailable');
    const scopes = t.scope.split(/\s+/);
    if (!['Contacts','Faxes','ReadAccounts','ReadMessages'].every(s => scopes.includes(s))) throw new Error('Provider permissions unavailable');
    return { accessToken: t.access_token, refreshToken: t.refresh_token, accessExpires: new Date(Date.now() + t.expires_in * 1000),
      refreshExpires: new Date(Date.now() + t.refresh_token_expires_in * 1000), scopes, ownerId: t.owner_id == null ? null : String(t.owner_id) };
  }
  exchange(code, verifier) { return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: this.config.redirectUri }); }
  refresh(refreshToken) { return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken }); }
  async identity(token) {
    const get = async path => {
      const r = await this.request(BASE + path, { redirect: 'error', headers: { Authorization: 'Bearer ' + token.accessToken, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('Provider identity unavailable'); return r.json();
    };
    const account = await get('/restapi/v1.0/account/~');
    const extension = await get('/restapi/v1.0/account/~/extension/~');
    const accountId = String(account.id), extensionId = String(extension.id);
    const matches = (uri, path) => { try { const u = new URL(uri); return u.origin === BASE && u.pathname === path && !u.search && !u.hash && !u.username && !u.password; } catch { return false; } };
    if (!numericId(accountId) || !numericId(extensionId) || accountId !== this.config.accountId ||
        !matches(account.uri, '/restapi/v1.0/account/' + accountId) ||
        !matches(extension.uri, '/restapi/v1.0/account/' + accountId + '/extension/' + extensionId) ||
        extension.status !== 'Enabled' || extension.type !== 'User' || (token.ownerId && token.ownerId !== extensionId)) throw new Error('Provider identity unavailable');
    return { accountId, extensionId, displayName: typeof extension.name === 'string' ? extension.name.slice(0,160) : 'RingCentral user' };
  }
  async revoke(token) {
    const r = await this.request(BASE + '/restapi/oauth/revoke', { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Basic ' + Buffer.from(this.config.clientId + ':' + this.config.clientSecret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('Provider revocation unavailable');
  }
}
