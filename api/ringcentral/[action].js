import { createRcHandler } from '../../server/ringcentral-v3/handler.js';

const paths = new Map([
  ['/api/ringcentral/connect', 'connect'],
  ['/api/ringcentral/callback', 'callback'],
  ['/api/ringcentral/connection', 'connection'],
  ['/api/ringcentral/disconnect', 'disconnect']
]);

export function ringCentralAction(requestUrl) {
  if (typeof requestUrl !== 'string' || !requestUrl.startsWith('/') || requestUrl.includes('#')) return null;
  const boundary = requestUrl.indexOf('?');
  const pathname = boundary === -1 ? requestUrl : requestUrl.slice(0, boundary);
  return paths.get(pathname) || null;
}

function notFound(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(404).json({ error: 'Not found' });
}

export function createRingCentralRouter(factory = createRcHandler) {
  const handlers = Object.fromEntries([...new Set(paths.values())].map(action => [action, factory(action)]));
  return (req, res) => {
    const action = ringCentralAction(req.url);
    return action ? handlers[action](req, res) : notFound(res);
  };
}

export default createRingCentralRouter();
