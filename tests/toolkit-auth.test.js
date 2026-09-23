import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
import { authConfig, SESSION_SECONDS } from '../server/auth/config.js';
import { verifyIdentity, exchangeCode } from '../server/auth/microsoft.js';
import { createAuthHandler, requireToolkitUser } from '../server/auth/service.js';
import { randomToken, hash, cookieValue, challenge } from '../server/auth/security.js';

export const config = authConfig({ ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  ENTRA_CLIENT_ID: '22222222-2222-4222-8222-222222222222', ENTRA_CLIENT_SECRET: 'synthetic-client-secret',
  TOOLKIT_ORIGIN: 'https://toolkit.example.test' });
const oid = '33333333-3333-4333-8333-333333333333';
function response() {
  return { headers: {}, statusCode: 200, setHeader(k,v) { this.headers[k] = v; },
    status(s) { this.statusCode = s; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}
function memoryStore() {
  const transactions = new Map(), sessions = new Map();
  return { transactions, sessions,
    async createTransaction(t) { transactions.set(t.stateHash, { ...t, expires: Date.now() + 600000 }); },
    async consumeTransaction(state, binding, redirect) {
      const t = transactions.get(state);
      if (!t || t.used || t.expires < Date.now() || t.bindingHash !== binding || t.redirectUri !== redirect) return null;
      t.used = true;
      return { nonce_hash: t.nonceHash, pkce_verifier: t.verifier };
    },
    async createSession(identity, tokenHash, old) {
      if (old) sessions.delete(old);
      sessions.set(tokenHash, { id: identity.objectId, entra_tenant_id: identity.tenantId,
        entra_object_id: identity.objectId, display_name: identity.displayName, active: true });
    },
    async resolveSession(h) { return sessions.get(h); },
    async revokeSession(h) { sessions.delete(h); }
  };
}
async function call(action, req, store, exchange) {
  const res = response();
  await createAuthHandler(action, { config, store, exchange })(req, res);
  return res;
}
async function login(store) {
  const res = await call('login', { method: 'GET', headers: {} }, store);
  const url = new URL(res.headers.Location);
  return { res, state: url.searchParams.get('state'), url, binding: res.headers['Set-Cookie'].split(';')[0] };
}
const identity = { tenantId: config.tenant, objectId: oid, displayName: 'Employee A' };

test('configuration rejects noncanonical origins and insecure production', () => {
  for (const origin of ['https://toolkit.example.test/', 'https://toolkit.example.test/path', 'http://example.test', 'https://user:pass@example.test']) {
    assert.throws(() => authConfig({ ENTRA_TENANT_ID: config.tenant, ENTRA_CLIENT_ID: config.clientId, ENTRA_CLIENT_SECRET: 'x', TOOLKIT_ORIGIN: origin }));
  }
  assert.throws(() => authConfig({ ENTRA_TENANT_ID: config.tenant, ENTRA_CLIENT_ID: config.clientId, ENTRA_CLIENT_SECRET: 'x', TOOLKIT_ORIGIN: 'http://localhost:5173', NODE_ENV: 'production' }));
});

test('login creates hashed, browser-bound transaction and S256 PKCE', async () => {
  const store = memoryStore();
  const { res, url, state, binding } = await login(store);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers['Set-Cookie'], /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.match(binding, /^__Host-toolkit_login=/);
  const t = store.transactions.get(hash(state));
  assert.equal(t.nonceHash, hash(url.searchParams.get('nonce')));
  assert.equal(t.bindingHash, hash(binding.split('=')[1]));
  assert.equal(url.searchParams.get('code_challenge'), challenge(t.verifier));
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(url.searchParams.get('scope'), 'openid profile');
  assert.ok(!res.headers.Location.includes(config.clientSecret));
});

test('callback consumes once, rotates session, redirects cleanly; session response is minimal; logout revokes', async () => {
  const store = memoryStore();
  const old = randomToken();
  await store.createSession(identity, hash(old));
  const { state, binding } = await login(store);
  let exchanges = 0;
  const exchange = async () => { exchanges++; return identity; };
  const req = { method: 'GET', url: `/api/auth/callback?state=${state}&code=synthetic-code`, headers: { cookie: `${binding}; ${config.sessionCookie}=${old}` } };
  const result = await call('callback', req, store, exchange);
  assert.equal(result.headers.Location, config.origin + '/');
  const sessionCookie = result.headers['Set-Cookie'][0];
  assert.match(sessionCookie, new RegExp(`HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}; Secure`));
  const token = sessionCookie.split(';')[0].split('=')[1];
  assert.notEqual(token, old);
  assert.ok(store.sessions.has(hash(token)));
  assert.ok(!store.sessions.has(token));
  assert.ok(!store.sessions.has(hash(old)));
  const replay = await call('callback', req, store, exchange);
  assert.equal(exchanges, 1);
  assert.match(replay.headers.Location, /toolkitAuth=failed$/);
  const sessionReq = { method: 'GET', headers: { cookie: sessionCookie.split(';')[0] } };
  const session = await call('session', sessionReq, store);
  assert.deepEqual(session.body, { authenticated: true, user: { displayName: 'Employee A' } });
  assert.equal(session.headers['Cache-Control'], 'no-store');
  const forbidden = await call('logout', { ...sessionReq, method: 'POST', headers: { ...sessionReq.headers, origin: 'https://attacker.test' } }, store);
  assert.equal(forbidden.statusCode, 403);
  assert.ok(store.sessions.has(hash(token)));
  const logout = await call('logout', { ...sessionReq, method: 'POST', headers: { ...sessionReq.headers, origin: config.origin } }, store);
  assert.equal(logout.statusCode, 200);
  assert.match(logout.headers['Set-Cookie'][0], /Max-Age=0/);
  assert.equal((await call('session', sessionReq, store)).statusCode, 401);
});

test('invalid state, binding, duplicate state, redirect, expired transaction and provider errors cannot create sessions', async () => {
  for (const variant of ['state', 'binding', 'duplicate', 'expired', 'origin', 'error']) {
    const store = memoryStore();
    const { state, binding } = await login(store);
    if (variant === 'expired') store.transactions.get(hash(state)).expires = 0;
    let url = `/api/auth/callback?state=${variant === 'state' ? randomToken() : state}&code=x`;
    if (variant === 'duplicate') url += '&state=' + state;
    if (variant === 'error') url += '&error=access_denied';
    if (variant === 'origin') url = 'https://attacker.test' + url;
    let exchanges = 0;
    const res = await call('callback', { method: 'GET', url, headers: { cookie: variant === 'binding' ? `${config.bindingCookie}=${randomToken()}` : binding } }, store,
      async () => { exchanges++; return identity; });
    assert.equal(exchanges, 0, variant);
    assert.equal(store.sessions.size, 0);
    assert.equal(res.headers.Location, config.origin + '/?toolkitAuth=failed');
  }
});

test('missing, invalid and duplicate sessions fail; inactive user 403; A and B remain isolated', async () => {
  const store = memoryStore();
  for (const cookie of ['', `${config.sessionCookie}=forged`, `${config.sessionCookie}=${randomToken()}`]) {
    assert.equal((await call('session', { method: 'GET', headers: { cookie } }, store)).statusCode, 401);
  }
  const a = randomToken(), b = randomToken();
  await store.createSession(identity, hash(a));
  await store.createSession({ ...identity, objectId: '44444444-4444-4444-8444-444444444444', displayName: 'B' }, hash(b));
  const req = token => ({ headers: { cookie: `${config.sessionCookie}=${token}` } });
  assert.equal((await requireToolkitUser(req(a), { config, store })).id, oid);
  assert.notEqual((await requireToolkitUser(req(b), { config, store })).id, oid);
  assert.equal(cookieValue({ headers: { cookie: `${config.sessionCookie}=${a}; ${config.sessionCookie}=${b}` } }, config.sessionCookie), null);
  store.sessions.get(hash(a)).active = false;
  await assert.rejects(requireToolkitUser(req(a), { config, store }), { status: 403 });
});

test('signed Microsoft ID token: signature, issuer, audience, time, tenant, nonce and user claims validated', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const nonce = randomToken();
  const claims = { tid: config.tenant, oid, nonce, sub: 'employee-subject', name: 'Employee A' };
  async function signed(overrides = {}, options = {}, key = privateKey) {
    return new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: 'RS256' })
      .setIssuer(options.issuer || config.issuer).setAudience(options.audience || config.clientId)
      .setIssuedAt().setNotBefore(options.nbf || Math.floor(Date.now()/1000) - 1)
      .setExpirationTime(options.exp || '5m').sign(key);
  }
  assert.deepEqual(await verifyIdentity(await signed(), config, hash(nonce), publicKey), identity);
  for (const token of [await signed({ tid: oid }), await signed({ nonce: 'wrong' }), await signed({ oid: 'not-an-id' }),
    await signed({ idtyp: 'app' }), await signed({ sub: '' }), await signed({}, { issuer: 'https://attacker.test' }),
    await signed({}, { audience: oid }), await signed({}, { exp: 1 }), await signed({}, { nbf: Math.floor(Date.now()/1000)+100 }), await signed({}, {}, other.privateKey)]) {
    await assert.rejects(verifyIdentity(token, config, hash(nonce), publicKey));
  }
});

test('method/CSRF enforcement and upstream failures do not leak sensitive diagnostics', async () => {
  const store = memoryStore();
  assert.equal((await call('logout', { method: 'GET', headers: {} }, store)).statusCode, 405);
  assert.equal((await call('login', { method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }, store)).statusCode, 403);
  store.createTransaction = () => { throw new Error('synthetic-secret-that-must-not-leak'); };
  const res = await call('login', { method: 'GET', headers: {} }, store);
  assert.equal(res.statusCode, 503);
  assert.ok(!JSON.stringify(res).includes('synthetic-secret'));
});

test('confidential code exchange uses fixed endpoints, secret, PKCE and validated Microsoft JWKS', async t => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const nonce = randomToken(), verifier = randomToken();
  const idToken = await new SignJWT({ tid: config.tenant, oid, nonce, name: 'Employee A' })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).setSubject('employee')
    .setIssuer(config.issuer).setAudience(config.clientId).setIssuedAt().setNotBefore('0s').setExpirationTime('5m').sign(privateKey);
  const jwk = { ...await exportJWK(publicKey), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
  let exchangeCount = 0, keyCount = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === `${config.authority}/oauth2/v2.0/token`) {
      exchangeCount++;
      assert.equal(options.redirect, 'error');
      assert.equal(options.body.get('client_secret'), config.clientSecret);
      assert.equal(options.body.get('code_verifier'), verifier);
      assert.equal(options.body.get('redirect_uri'), config.redirectUri);
      assert.equal(options.body.get('code'), 'synthetic-code');
      return Response.json({ id_token: idToken, access_token: 'synthetic-access-token' });
    }
    assert.equal(String(url), `${config.authority}/discovery/v2.0/keys`);
    keyCount++;
    return Response.json({ keys: [jwk] });
  });
  const result = await exchangeCode('synthetic-code', { nonce_hash: hash(nonce), pkce_verifier: verifier }, config);
  assert.deepEqual(result, identity);
  assert.equal(exchangeCount, 1); assert.equal(keyCount, 1);
  assert.ok(!JSON.stringify(result).includes('token'));
  await assert.rejects(exchangeCode('synthetic-code', { nonce_hash: hash('wrong'), pkce_verifier: verifier }, config));
});
