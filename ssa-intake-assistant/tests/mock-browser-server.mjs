// Synthetic, local-only browser verification server. Never accepts client-data uploads.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.gz': 'application/octet-stream' };
createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/auth/session') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(url.searchParams.has('preferences')
      ? { accountId: 'synthetic-user', values: null }
      : { authenticated: true, user: { displayName: 'Synthetic Employee' } }));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    response.writeHead(404).end();
    return;
  }
  const path = resolve(root, '.' + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
  if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const data = await readFile(path);
    response.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    response.end(data);
  } catch { response.writeHead(404).end(); }
}).listen(5180, '127.0.0.1');
