import { authConfig } from '../auth/config.js';
import { requireToolkitUser } from '../auth/service.js';
import { cookieValue, cookie, hash, validToken, sameOrigin } from '../auth/security.js';
import { v3Runtime } from './runtime.js';
import { RcStore } from './store.js';
import { RcService } from './service.js';
import { RingCentralProvider } from './provider.js';
export function createRcHandler(action, dependencies = {}) {
  return async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Content-Type-Options','nosniff');
    const method = ['connect','disconnect'].includes(action) ? 'POST' : 'GET';
    if (req.method !== method) { res.setHeader('Allow',method); return res.status(405).json({ error: 'Method not allowed' }); }
    let config;
    const testPage = outcome => {
      try { config ||= dependencies.config || v3Runtime(); } catch { return false; }
      if (!(config.productionAcceptance === true || (dependencies.developmentTestPage && config.environment === 'development' && config.origin === 'http://localhost:5173'))) return false;
      res.setHeader('Location',config.origin+'/fax-sender-v3/?connection='+outcome);
      res.status(303).end(); return true;
    };
    try {
      const auth = dependencies.authConfig || authConfig();
      const user = await (dependencies.requireUser || requireToolkitUser)(req, { config: auth });
      config = dependencies.config || v3Runtime();
      if (auth.origin !== config.origin) throw new Error();
      const session = cookieValue(req,auth.sessionCookie);
      if (!session) return res.status(401).json({ error: 'Toolkit sign-in required' });
      if (method === 'POST') sameOrigin(req,config);
      const service = dependencies.service || new RcService(config,new RcStore(),new RingCentralProvider(config));
      if (action === 'connection') return res.status(200).json(await service.status(user.id));
      if (action === 'connect') {
        const result = await service.connect(user.id,hash(session));
        res.setHeader('Set-Cookie',cookie(config.bindingCookie,result.binding,600,config.secure));
        res.setHeader('Location',result.url); return res.status(303).end();
      }
      if (action === 'disconnect') { await service.disconnect(user.id); return res.status(200).json({ state: 'disconnected' }); }
      if (action !== 'callback') throw new Error();
      const url = new URL(req.url,config.origin);
      const state = url.searchParams.getAll('state'), code = url.searchParams.getAll('code');
      const binding = cookieValue(req,config.bindingCookie);
      if (url.origin !== config.origin || url.pathname !== '/api/ringcentral/callback' || url.searchParams.has('error') ||
          state.length !== 1 || !validToken(state[0]) || code.length !== 1 || !code[0] || code[0].length>4096 || !binding) throw new Error();
      await service.callback(user.id,hash(session),state[0],binding,code[0]);
      res.setHeader('Set-Cookie',cookie(config.bindingCookie,'',0,config.secure));
      if (testPage('connected')) return;
      // Backend-only Phase 1: finish on the safe status response, never the v2 page.
      res.setHeader('Location',config.origin+'/api/ringcentral/connection'); return res.status(303).end();
    } catch (error) {
      if (action === 'callback' && config) res.setHeader('Set-Cookie',cookie(config.bindingCookie,'',0,config.secure));
      if (['connect','callback'].includes(action) && testPage('failed')) return;
      const status = [401,403].includes(error.status) ? error.status : 503;
      return res.status(status).json({ error: status === 401 ? 'Toolkit sign-in required' : status === 403 ? 'Request not permitted' : 'RingCentral connection unavailable. Retry or reconnect.' });
    }
  };
}
