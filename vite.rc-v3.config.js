// Opt-in Development backend harness. Normal vite.config.js is unchanged.
import { mergeConfig } from 'vite';
import base from './vite.config.js';
import { createRcHandler } from './server/ringcentral-v3/handler.js';
import { createFaxHandler } from './server/fax-v3/handler.js';
import { readFile } from 'node:fs/promises';
export default mergeConfig(base, { plugins: [{ name: 'isolated-ringcentral-v3', configureServer(server) {
  const handlers = Object.fromEntries(['connect','callback','connection','disconnect'].map(a => ['/api/ringcentral/'+a,createRcHandler(a,{developmentTestPage:true})]));
  for(const action of ['context','contacts','send','status','message','receipt','history']) handlers['/api/fax-v3/'+action]=createFaxHandler(action);
  const pages = { '/fax-sender-v3/': ['index.html','text/html; charset=utf-8'], '/fax-sender-v3/test.js': ['test.js','text/javascript; charset=utf-8'] };
  for(const file of ['app.js','client.js','style.css']) pages['/fax-sender-v3/'+file]=[file,file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'];
  server.middlewares.use(async (req,res,next) => {
    const path=req.url?.split('?')[0];
    // These files are outside public/ and normal build inputs: only this opt-in
    // Development server exposes the test route. Never serve via configurePreviewServer.
    if (!path?.startsWith('/fax-sender-v3')) return next();
    if ((process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'development') ||
        (process.env.VERCEL && process.env.VERCEL_ENV !== 'development') ||
        (process.env.TOOLKIT_ORIGIN && process.env.TOOLKIT_ORIGIN !== 'http://localhost:5173')) { res.statusCode=404; return res.end(); }
    // Native POST needs its same-origin Origin for CSRF validation. Suppress
    // cross-origin referrers; OAuth endpoints retain their own no-referrer policy.
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(path==='/fax-sender-v3'){res.statusCode=302;res.setHeader('Location','/fax-sender-v3/');return res.end();}
    if(!pages[path]){res.statusCode=404;return res.end();}
    if(req.method!=='GET'){res.statusCode=405;res.setHeader('Allow','GET');return res.end();}
    try{const [file,type]=pages[path];res.setHeader('Content-Type',type);res.end(await readFile(new URL('./development/fax-sender-v3/'+file,import.meta.url)));}
    catch{res.statusCode=503;res.end('Development test page unavailable.');}
  });
  server.middlewares.use((req,res,next) => {
    const handler = handlers[req.url?.split('?')[0]];
    if (!handler) return next();
    res.status = code => { res.statusCode=code; return res; };
    res.json = data => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); };
    return handler(req,res);
  });
} }] });
