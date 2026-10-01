// Compare an original production build with the reorganized build, using synthetic API responses.
// node tests/structure-browser-check.mjs <chromium> <original-dist-directory>
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';

const [browserPath, baseline] = process.argv.slice(2);
assert(browserPath && baseline, 'Provide Chromium and the original production build');
const failures = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.pdf': 'application/pdf' };
async function serve(directory) {
  const root = resolve(directory);
  const server = createServer(async (req, res) => {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/auth/session' || pathname === '/api/ringcentral-contacts') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(pathname.endsWith('session') ? { authenticated: false } : { success: true, contacts: [] }));
    }
    if (pathname.startsWith('/api/')) { failures.push(pathname); res.writeHead(500).end(); return; }
    try {
      const file = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : decodeURIComponent(pathname)));
      assert(file.startsWith(root + sep));
      const body = await readFile(file);
      res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch { failures.push(pathname); res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
const before = await serve(baseline), after = await serve('dist');
const profile = await mkdtemp(join(tmpdir(), 'toolkit-structure-'));
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
async function until(fn) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await fn()) return; await new Promise(done => setTimeout(done, 50)); }
  throw new Error('Browser condition timed out');
}
try {
  let port;
  await until(async () => { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return port; } catch { return false; } });
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(done => { socket.onopen = done; });
  const pending = new Map(); let id = 0;
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) { const p = pending.get(event.id); pending.delete(event.id); event.error ? p.reject(Error(event.error.message)) : p.resolve(event.result); }
    if (event.method === 'Runtime.exceptionThrown') failures.push('Browser exception');
  };
  function cdp(method, params = {}) { return new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression) {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value;
  }
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  async function visit(origin, path) {
    await cdp('Page.navigate', { url: origin + path });
    await until(() => evaluate(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && !!document.querySelector('.toolkit-auth a')`));
    await evaluate('document.fonts.ready');
  }
  async function snapshot(origin, path, theme, density) {
    await visit(origin, path);
    await evaluate(`PackardSettings.setSetting('theme', ${JSON.stringify(theme)}); PackardSettings.setSetting('density', ${JSON.stringify(density)})`);
    await new Promise(done => setTimeout(done, 100));
    return evaluate(`Array.from(document.body.querySelectorAll('*')).filter(el => !['SCRIPT','LINK'].includes(el.tagName)).map(el => {
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      return { tag: el.tagName, id: el.id, class: el.getAttribute('class'),
        box: [box.x,box.y,box.width,box.height],
        style: Object.fromEntries(Array.from(style).map(key => [key, style.getPropertyValue(key).split(location.origin).join('')])) };
    })`);
  }
  for (const width of [1280, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    for (const path of ['/', '/canned-remarks/', '/settings/', '/version-history/', '/fax-sender/', '/intake-checker/', '/med-tabs-generator/', '/welcome-email-sender/']) {
      for (const theme of ['light', 'dark', 'sepia', 'forest', 'blossom']) for (const density of ['comfortable', 'compact']) {
        const a = await snapshot(before.origin, path, theme, density);
        const b = await snapshot(after.origin, path, theme, density);
        assert.equal(a.length, b.length, `${path}: element count`);
        for (let i = 0; i < a.length; i++) {
          if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
            const changes = Object.keys(a[i].style).filter(key => a[i].style[key] !== b[i].style[key]);
            assert.fail(`${width}px ${path} ${theme}/${density} element ${i} ${a[i].tag}#${a[i].id}.${a[i].class}: ${JSON.stringify({ beforeBox:a[i].box, afterBox:b[i].box, changes:changes.map(key=>[key,a[i].style[key],b[i].style[key]]) })}`);
          }
        }
      }
      console.log(`PASS exact computed styles/layout: ${width}px ${path}, five themes, two densities`);
    }
  }
  for (const { origin } of [before, after]) {
    await cdp('Page.navigate', { url: origin + '/pages/canned-remarks.html?stage2=synthetic#retained' });
    await until(() => evaluate("location.pathname === '/canned-remarks/' && document.readyState === 'complete' && !!document.getElementById('remarkList')"));
    assert.equal(await evaluate('location.search + location.hash'), '?stage2=synthetic#retained');
  }
  assert.deepEqual(failures, []);
  console.log('PASS legacy redirect preserves route, query and hash; no missing assets or runtime errors.');
} finally {
  socket?.close(); browser.kill();
  await Promise.all([before, after].map(({ server }) => new Promise(done => server.close(done))));
}
