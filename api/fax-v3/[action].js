import { createFaxHandler } from '../../server/fax-v3/handler.js';

export const config = { api: { bodyParser: false } };

const paths = new Map([
  ['/api/fax-v3/contacts', 'contacts'],
  ['/api/fax-v3/context', 'context'],
  ['/api/fax-v3/history', 'history'],
  ['/api/fax-v3/message', 'message'],
  ['/api/fax-v3/receipt', 'receipt'],
  ['/api/fax-v3/send', 'send'],
  ['/api/fax-v3/status', 'status']
]);

export function faxV3Action(requestUrl) {
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

export function createFaxV3Router(factory = createFaxHandler) {
  const handlers = Object.fromEntries([...new Set(paths.values())].map(action => [action, factory(action)]));
  return (req, res) => {
    const action = faxV3Action(req.url);
    return action ? handlers[action](req, res) : notFound(res);
  };
}

export default createFaxV3Router();
