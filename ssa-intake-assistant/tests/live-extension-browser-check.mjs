// Synthetic Toolkit page with the unpacked live extension; external SSA DNS is blocked.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { completeSyntheticIntake } from './complete-intake.mjs';
import { LIVE_EXTENSION_ID } from '../src/model/live-extension-id.js';

const browser = process.argv[2];
assert(browser, 'Provide Chrome executable');
const root = resolve('dist');
const extensionPath = resolve('ssa-intake-assistant/extension-live-dev');
const directory = await mkdtemp(join(tmpdir(), 'ssa-live-extension-synthetic-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const requests = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push({ method: request.method, path: url.pathname });
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/auth/session') {
    response.setHeader('Content-Type', 'application/json');
    return response.end(JSON.stringify(url.searchParams.has('preferences')
      ? { accountId: 'synthetic-user', values: null }
      : { authenticated: true, user: { displayName: 'Synthetic Employee' } }));
  }
  if (url.pathname.startsWith('/api/')) return response.writeHead(404).end();
  const path = resolve(root, '.' + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
  if (!path.startsWith(root + sep)) return response.writeHead(403).end();
  try {
    response.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(5173, '127.0.0.1', done));

const child = spawn(browser, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP secure.ssa.gov ~NOTFOUND',
  `--user-data-dir=${join(directory, 'profile')}`,
], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let nextId = 0;
let buffer = '';
const pending = new Map();
child.stdio[4].on('data', data => {
  buffer += data.toString();
  while (buffer.includes('\0')) {
    const end = buffer.indexOf('\0');
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (!message.id) continue;
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (call) message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
  }
});
function cdp(method, params = {}, sessionId) {
  return new Promise((resolveCall, reject) => {
    pending.set(++nextId, { resolve: resolveCall, reject });
    child.stdio[3].write(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function until(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(done => setTimeout(done, 75));
  }
  throw new Error(`Timed out: ${label}`);
}
async function createPage(url) {
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, sessionId);
  await cdp('Runtime.enable', {}, sessionId);
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    }, sessionId);
    assert(!result.exceptionDetails, 'Synthetic page evaluation failed');
    return result.result.value;
  };
  await cdp('Page.navigate', { url }, sessionId);
  await until(() => evaluate('document.readyState === "complete"'), 'page load');
  return { evaluate, targetId };
}

try {
  const loaded = await cdp('Extensions.loadUnpacked', { path: extensionPath });
  assert.equal(loaded.id, LIVE_EXTENSION_ID);
  const page = await createPage('http://127.0.0.1:5173/intake-checker/');
  await until(() => page.evaluate("!!document.querySelector('.toolkit-auth-name')"), 'authenticated Toolkit page');
  await page.evaluate(`(() => {
    const field = document.getElementById('intakeText');
    field.value = ${JSON.stringify(completeSyntheticIntake())};
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#intakeForm button[type=submit]').click();
  })()`);
  await until(() => page.evaluate("!document.getElementById('continueToSsa').hidden"), 'synthetic intake review');
  await page.evaluate("document.querySelectorAll('#validationIssues .intake-reviewed, #reviewItems .intake-reviewed').forEach(button => button.click())");
  await until(() => page.evaluate("!document.getElementById('continueToSsa').disabled"), 'synthetic intake ready');
  await page.evaluate("document.getElementById('continueToSsa').click()");
  await until(() => page.evaluate("!!document.getElementById('ssaReentryNumber')"), 'identity launch controls');
  const pageStorage = await page.evaluate('JSON.stringify([localStorage, sessionStorage])');
  await page.evaluate(`(() => {
    const input = document.getElementById('ssaReentryNumber');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'SYNTHETIC-REENTRY');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Open SSA application').click();
  })()`);
  await until(() => page.evaluate("document.querySelector('.live-launch [role=status]')?.textContent.includes('The SSA page did not match')"
    + " || document.querySelector('.live-launch [role=status]')?.textContent.includes('could not be verified')"), 'blocked SSA DNS failure');
  const targets = await cdp('Target.getTargets');
  assert(targets.targetInfos.some(target => target.url.startsWith('https://secure.ssa.gov/iClaim/dib')));
  assert(requests.every(request => request.method === 'GET' && request.path !== '/api/' && !/ssn|reentry/i.test(request.path)));
  assert.equal(await page.evaluate('JSON.stringify([localStorage, sessionStorage])'), pageStorage);
  assert.equal(await page.evaluate("document.getElementById('ssaReentryNumber').value"), '');
  assert(!requests.some(request => /000-12-3456|SYNTHETIC-REENTRY/.test(request.path)));
  console.log('PASS: unpacked extension loaded; synthetic Toolkit sent only identity values; secure.ssa.gov DNS was blocked; no client value reached local HTTP requests or browser storage.');
} finally {
  try { await cdp('Browser.close'); } catch { /* Browser may already have exited. */ }
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([once(child, 'exit'), new Promise(done => setTimeout(done, 10000))]);
  }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
