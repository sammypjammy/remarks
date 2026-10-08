// Actual unpacked Chrome extension; SSA DNS is blocked so this never loads the live site.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const browser = process.argv[2];
assert(browser, 'Provide Chrome executable');
const directory = await mkdtemp(join(tmpdir(), 'ssa-launch-synthetic-'));
const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  if (request.url !== '/intake-checker/') return response.writeHead(404).end();
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Synthetic Toolkit source</title><p>No client data</p>');
});
await new Promise((done, reject) => server.listen(5173, '127.0.0.1', error => error ? reject(error) : done()));
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  '--host-resolver-rules=MAP secure.ssa.gov ~NOTFOUND',
  `--user-data-dir=${join(directory, 'profile')}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let nextId = 0, buffer = '';
const pending = new Map();
child.stdio[4].on('data', data => {
  buffer += data.toString();
  while (buffer.includes('\0')) {
    const end = buffer.indexOf('\0'), message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id) {
      const entry = pending.get(message.id); pending.delete(message.id);
      message.error ? entry.reject(Error(message.error.message)) : entry.resolve(message.result);
    }
  }
});
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    pending.set(++nextId, { resolve, reject });
    child.stdio[3].write(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function until(check) {
  for (let n = 0; n < 150; n++) { if (await check()) return; await new Promise(done => setTimeout(done, 100)); }
  throw Error('Synthetic Chrome condition timed out');
}
try {
  const { id } = await cdp('Extensions.loadUnpacked', { path: resolve('ssa-intake-assistant/extension-live-dev') });
  assert.equal(id, 'hgdlmijfhcapopeohiallpfihfimdjem');
  const { targetId } = await cdp('Target.createTarget', { url: 'http://127.0.0.1:5173/intake-checker/' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Runtime.enable', {}, sessionId);
  const evaluate = async expression => {
    const reply = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    assert(!reply.exceptionDetails, reply.exceptionDetails?.text || reply.exceptionDetails?.exception?.description);
    return reply.result.value;
  };
  await until(() => evaluate("location.href === 'http://127.0.0.1:5173/intake-checker/' && document.readyState === 'complete'"));
  assert.equal(await evaluate('location.href'), 'http://127.0.0.1:5173/intake-checker/');
  assert.equal(await evaluate('document.title'), 'Synthetic Toolkit source');
  await until(() => evaluate("typeof chrome.runtime === 'object'"));
  const result = await evaluate(`new Promise(resolve => chrome.runtime.sendMessage(${JSON.stringify(id)},
    {type:'start-identity',session:'11111111-1111-4111-8111-111111111111',
      ssn:'000-12-3456',reentry:'SYNTHETIC-REENTRY'},
    reply => resolve({reply, error:chrome.runtime.lastError?.message || null})))`);
  assert.deepEqual(result, { reply: { opened: true }, error: null });
  await until(async () => (await cdp('Target.getTargets')).targetInfos.some(target =>
    target.url === 'https://secure.ssa.gov/iClaim/dib'));
  assert(requests.includes('/intake-checker/'));
  assert(requests.every(path => path === '/intake-checker/' || path === '/favicon.ico'));
  console.log('PASS actual Chrome extension: synthetic identity session opened one SSA URL; SSA network blocked; no client-data service');
} finally {
  try { await cdp('Browser.close'); } catch { child.kill(); }
  server.close();
}
