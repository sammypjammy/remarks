// Production frontend, synthetic auth boundary; never contacts Microsoft or RingCentral.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('dist');
const failures = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.pdf': 'application/pdf' };
let signedIn = false, loginCount = 0, logoutCount = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (path === '/api/auth/session') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(signedIn ? { authenticated: true, user: { displayName: 'Synthetic Employee With A Long Display Name' } } : { authenticated: false }));
  }
  if (path === '/api/auth/login') {
    loginCount++; signedIn = true;
    res.writeHead(303, { Location: '/', 'Set-Cookie': 'toolkit_session=synthetic-browser-cookie; HttpOnly; SameSite=Lax; Path=/' });
    return res.end();
  }
  if (path === '/api/auth/logout') {
    assert.equal(req.method, 'POST');
    logoutCount++; signedIn = false;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'toolkit_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    return res.end(JSON.stringify({ authenticated: false }));
  }
  if (path.startsWith('/api/')) {
    failures.push('Unexpected API request');
    res.writeHead(500).end(); return;
  }
  try {
    const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    assert(file.startsWith(root + sep));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { failures.push('Missing static resource'); res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'toolkit-auth-browser-'));
const browser = spawn(process.argv[2], ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
async function until(fn) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await fn()) return; await new Promise(done => setTimeout(done, 50)); }
  throw new Error('Browser condition timed out');
}
try {
  let port;
  await until(async () => { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return port; } catch { return false; } });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise(done => { socket.onopen = done; });
  const pending = new Map(); let id = 0;
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) { const p = pending.get(event.id); pending.delete(event.id); event.error ? p.reject(new Error('CDP failed')) : p.resolve(event.result); }
    if (event.method === 'Runtime.exceptionThrown') failures.push('Browser exception');
  };
  function cdp(method, params = {}) { return new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression) {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    assert(!r.exceptionDetails, 'Browser evaluation'); return r.result.value;
  }
  await cdp('Runtime.enable'); await cdp('Page.enable');
  for (const width of [1280,390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    for (const path of ['/', '/fax-sender/', '/welcome-email-sender/', '/intake-checker/', '/canned-remarks/', '/med-tabs-generator/', '/settings/', '/version-history/']) {
      signedIn = false;
      await cdp('Page.navigate', { url: origin + path });
      await until(() => evaluate("document.readyState === 'complete' && !!document.querySelector('.toolkit-auth a') && !document.querySelector('.toolkit-auth a').hidden"));
      assert.equal(await evaluate("document.querySelector('.toolkit-auth a').textContent"), 'Sign in with Microsoft');
      assert.equal(await evaluate("document.querySelector('.toolkit-auth a').getAttribute('href')"), '/api/auth/login');
      assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `signed out overflow ${path} ${width}`);
      signedIn = true;
      await evaluate("window.dispatchEvent(new Event('focus'))");
      await until(() => evaluate("!!document.querySelector('.toolkit-auth button') && !document.querySelector('.toolkit-auth button').hidden"));
      assert(await evaluate("document.querySelector('.toolkit-auth-name').textContent.startsWith('Synthetic Employee')"));
      assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `signed in overflow ${path} ${width}`);
      assert(await evaluate("!JSON.stringify(localStorage).includes('toolkit_session') && !JSON.stringify(sessionStorage).includes('toolkit_session') && !document.cookie.includes('toolkit_session')"));
      await evaluate("document.querySelector('.toolkit-auth button').click()");
      await until(() => evaluate("document.querySelector('.toolkit-auth button').hidden"));
      await evaluate("document.querySelector('.app-menu-toggle').click()");
      await until(() => evaluate("!!document.querySelector('.toolkit-navigation') && document.querySelector('.toolkit-navigation').getClientRects().length > 0"));
    }
    await cdp('Page.navigate', { url: origin + '/' });
    await until(() => evaluate("document.readyState === 'complete' && !!document.querySelector('.toolkit-auth a')"));
    await evaluate("document.querySelector('.toolkit-auth a').click()");
    await until(() => evaluate("document.readyState === 'complete' && !!document.querySelector('.toolkit-auth button') && !document.querySelector('.toolkit-auth button').hidden"));
    assert(await evaluate("!document.cookie.includes('toolkit_session')"), 'opaque cookie inaccessible to JS');
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(profile, `auth-${width}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`PASS auth UI ${width}px: eight pages, signed out/in, logout, login link, navigation, privacy, no overflow.`);
  }
  assert.equal(loginCount, 2); assert.equal(logoutCount, 16); assert.deepEqual(failures, []);
  console.log(`Screenshots: ${profile}`);
} finally { socket?.close(); browser.kill(); await new Promise(done => server.close(done)); }
