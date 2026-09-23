import { authConfig, SESSION_SECONDS, TRANSACTION_SECONDS } from './config.js';
import { AuthStore } from './store.js';
import { exchangeCode } from './microsoft.js';
import { randomToken, hash, challenge, cookie, cookieValue, validToken, authError, sameOrigin } from './security.js';

export async function requireToolkitUser(req, { config = authConfig(), store } = {}) {
  const token = cookieValue(req, config.sessionCookie);
  if (!token) throw authError(401);
  const user = await (store || new AuthStore()).resolveSession(hash(token));
  if (!user) throw authError(401);
  if (!user.active || user.entra_tenant_id !== config.tenant) throw authError(403);
  return { id: user.id, tenantId: user.entra_tenant_id, objectId: user.entra_object_id, displayName: user.display_name };
}

export function createAuthHandler(action, dependencies = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const method = action === 'logout' ? 'POST' : 'GET';
    if (req.method !== method) {
      res.setHeader('Allow', method);
      return res.status(405).json({ error: 'Method not allowed' });
    }
    let config;
    try {
      config = dependencies.config || authConfig();
      const store = dependencies.store || new AuthStore();
      if (action === 'session') {
        const user = await requireToolkitUser(req, { config, store });
        return res.status(200).json({ authenticated: true, user: { displayName: user.displayName } });
      }
      if (action === 'logout') {
        sameOrigin(req, config);
        const token = cookieValue(req, config.sessionCookie);
        if (token) await store.revokeSession(hash(token));
        res.setHeader('Set-Cookie', [cookie(config.sessionCookie, '', 0, config.secure), cookie(config.bindingCookie, '', 0, config.secure)]);
        return res.status(200).json({ authenticated: false });
      }
      if (action === 'login') {
        // Reject cross-site subresource/navigation initiation; direct visits remain allowed.
        if (req.headers?.['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw authError(403);
        const state = randomToken(), binding = randomToken(), nonce = randomToken(), verifier = randomToken();
        await store.createTransaction({ stateHash: hash(state), bindingHash: hash(binding), nonceHash: hash(nonce), verifier, redirectUri: config.redirectUri });
        res.setHeader('Set-Cookie', cookie(config.bindingCookie, binding, TRANSACTION_SECONDS, config.secure));
        const params = new URLSearchParams({ client_id: config.clientId, response_type: 'code', response_mode: 'query',
          redirect_uri: config.redirectUri, scope: 'openid profile', state, nonce,
          code_challenge: challenge(verifier), code_challenge_method: 'S256', prompt: 'select_account' });
        res.setHeader('Location', `${config.authority}/oauth2/v2.0/authorize?${params}`);
        return res.status(302).end();
      }
      if (action !== 'callback') throw authError(404);
      const url = new URL(req.url, config.origin);
      if (url.origin !== config.origin || url.pathname !== '/api/auth/callback') throw authError(400);
      const params = url.searchParams;
      const states = params.getAll('state'), codes = params.getAll('code');
      const binding = cookieValue(req, config.bindingCookie);
      if (states.length !== 1 || !validToken(states[0]) || !binding) throw authError(400);
      const transaction = await store.consumeTransaction(hash(states[0]), hash(binding), config.redirectUri);
      if (!transaction) throw authError(400);
      if (params.has('error') || codes.length !== 1 || !codes[0] || codes[0].length > 8192) throw authError(401);
      const identity = await (dependencies.exchange || exchangeCode)(codes[0], transaction, config);
      const token = randomToken();
      const previous = cookieValue(req, config.sessionCookie);
      await store.createSession(identity, hash(token), previous ? hash(previous) : null);
      res.setHeader('Set-Cookie', [cookie(config.sessionCookie, token, SESSION_SECONDS, config.secure), cookie(config.bindingCookie, '', 0, config.secure)]);
      res.setHeader('Location', config.origin + '/');
      return res.status(303).end();
    } catch (error) {
      // All provider/DB errors are deliberately discarded; no exception logging here.
      if (action === 'callback' && config) {
        res.setHeader('Set-Cookie', cookie(config.bindingCookie, '', 0, config.secure));
        res.setHeader('Location', config.origin + '/?toolkitAuth=failed');
        return res.status(303).end();
      }
      const status = [400,401,403,404].includes(error.status) ? error.status : 503;
      return res.status(status).json({ authenticated: false,
        error: status === 403 ? 'Toolkit access is unavailable for this account.' : status === 401 ? 'Sign in to the Toolkit.' : 'Toolkit sign-in is temporarily unavailable.' });
    }
  };
}
