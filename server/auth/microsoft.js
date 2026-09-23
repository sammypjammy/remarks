import { createRemoteJWKSet, jwtVerify } from 'jose';
import { uuidPattern } from './config.js';
import { authError, equalHash, hash } from './security.js';

const keySets = new Map();
export async function verifyIdentity(idToken, config, nonceHash, keySet) {
  if (!keySet) {
    if (!keySets.has(config.tenant)) keySets.set(config.tenant,
      createRemoteJWKSet(new URL(`${config.authority}/discovery/v2.0/keys`), { timeoutDuration: 10_000 }));
    keySet = keySets.get(config.tenant);
  }
  const { payload } = await jwtVerify(idToken, keySet, {
    issuer: config.issuer, audience: config.clientId, algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'nbf', 'sub', 'tid', 'oid', 'nonce'], clockTolerance: 5
  });
  if (payload.tid !== config.tenant || !uuidPattern.test(payload.oid) ||
      typeof payload.sub !== 'string' || !payload.sub || payload.idtyp === 'app' ||
      typeof payload.nonce !== 'string' || !equalHash(hash(payload.nonce), nonceHash) ||
      (payload.azp && payload.azp !== config.clientId)) throw authError(403);
  const displayName = typeof payload.name === 'string'
    ? payload.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) : '';
  return { tenantId: config.tenant, objectId: payload.oid.toLowerCase(), displayName: displayName || 'Packard employee' };
}

export async function exchangeCode(code, transaction, config) {
  const response = await fetch(`${config.authority}/oauth2/v2.0/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
      grant_type: 'authorization_code', code, redirect_uri: config.redirectUri,
      code_verifier: transaction.pkce_verifier, scope: 'openid profile' })
  });
  if (!response.ok) throw authError(401);
  const result = await response.json();
  if (typeof result.id_token !== 'string') throw authError(401);
  // No Microsoft tokens are persisted, returned to the browser, or logged.
  return verifyIdentity(result.id_token, config, transaction.nonce_hash);
}
