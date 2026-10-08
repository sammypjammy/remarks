// Run after npm run build. Uses synthetic PDFs and a local static server.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
assert(chrome, 'Chrome or Edge is required for the browser download check.');
const root = resolve('dist');
const temporary = await mkdtemp(join(tmpdir(), 'document-splitter-test-'));
const downloadsSingle = join(temporary, 'single');
const downloadsMultiple = join(temporary, 'multiple');
await mkdir(downloadsSingle);
await mkdir(downloadsMultiple);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const requests = [];
const consoleMessages = [];
const server = createServer(async (req, res) => {
  requests.push({ method: req.method, path: req.url });
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/api/auth/session') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated: false }));
    return;
  }
  const path = resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'profile')}`, 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let socket;
const pause = () => new Promise(done => setTimeout(done, 50));
async function until(check, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause();
  }
  throw new Error(`Timed out: ${message}`);
}

try {
  let port;
  await until(async () => {
    try { port = (await readFile(join(temporary, 'profile', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return Boolean(port); }
    catch { return false; }
  }, 'browser startup');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => { socket.onopen = resolveOpen; socket.onerror = rejectOpen; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push((event.params.args || []).map(argument => argument.value || argument.description || '').join(' '));
      return;
    }
    if (!event.id) return;
    const request = pending.get(event.id);
    pending.delete(event.id);
    if (event.error) request.reject(new Error(event.error.message));
    else request.resolve(event.result);
  };
  function cdp(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); rejectCall(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolveCall(value); },
        reject: error => { clearTimeout(timer); rejectCall(error); }
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  }
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Network.enable');
  await cdp('Page.navigate', { url: `${origin}/document-splitter/` });
  await until(() => evaluate("document.readyState === 'complete' && document.querySelectorAll('.splitter-preset-piece').length === 4"), 'splitter ready');

  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.deepEqual(await evaluate(`(() => {
    document.getElementById('documentType').value = 'other';
    document.getElementById('documentType').dispatchEvent(new Event('change'));
    return {
      columns: getComputedStyle(document.getElementById('pieceFields')).gridTemplateColumns.split(' ').length,
      heading: getComputedStyle(document.querySelector('.splitter-heading')).flexDirection,
      fits: document.documentElement.scrollWidth <= innerWidth
    };
  })()`), { columns: 2, heading: 'row', fits: true }, 'Desktop layout must retain two setup columns without horizontal overflow.');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.deepEqual(await evaluate(`(() => ({
    columns: getComputedStyle(document.getElementById('pieceFields')).gridTemplateColumns.split(' ').length,
    heading: getComputedStyle(document.querySelector('.splitter-heading')).flexDirection,
    fits: document.documentElement.scrollWidth <= innerWidth
  }))()`), { columns: 1, heading: 'column', fits: true }, 'Mobile layout must stack controls without horizontal overflow.');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.getElementById('documentType').value = 'intake'; document.getElementById('documentType').dispatchEvent(new Event('change'))");

  const fixture = await PDFDocument.create();
  fixture.setTitle('CLIENT_DOCUMENT_CONTENT_CANARY');
  for (let page = 1; page <= 11; page++) fixture.addPage([200 + page, 300 + page]);
  const base64 = Buffer.from(await fixture.save()).toString('base64');
  async function chooseFiles(names) {
    await evaluate(`(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), c => c.charCodeAt(0));
      const transfer = new DataTransfer();
      for (const name of ${JSON.stringify(names)}) transfer.items.add(new File([bytes], name, { type: 'application/pdf' }));
      const input = document.getElementById('documentFiles');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await until(() => evaluate(`document.getElementById('splitterStatus').textContent === '${names.length * 4} PDFs ready.'`), 'PDF processing');
  }
  async function downloaded(path, name) {
    await until(async () => (await readdir(path)).includes(name), `download ${name}`);
    return readFile(join(path, name));
  }
  async function verifyPdf(bytes, expectedPages) {
    const pdf = await PDFDocument.load(bytes);
    assert.deepEqual(pdf.getPages().map(page => page.getWidth()), expectedPages.map(page => 200 + page));
  }

  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsSingle });
  await chooseFiles(['Private Client.pdf']);
  assert.equal(await evaluate("document.querySelectorAll('#documentResults button').length"), 4);
  await evaluate("document.querySelector('#documentResults button').click()");
  await verifyPdf(await downloaded(downloadsSingle, '1696.pdf'), [1, 2, 3, 4]);
  await evaluate("document.getElementById('downloadAll').click()");
  const singleZip = unzipSync(await downloaded(downloadsSingle, 'document-splits.zip'));
  assert.deepEqual(Object.keys(singleZip).sort(), ['1693.pdf', '1696.pdf', '3288.pdf', '827.pdf'].sort());
  await verifyPdf(singleZip['1693.pdf'], [5, 6, 7]);
  await verifyPdf(singleZip['3288.pdf'], [10]);
  await verifyPdf(singleZip['827.pdf'], [11]);

  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsMultiple });
  await chooseFiles(['Private Client.pdf', 'Second Client.pdf']);
  assert.equal(await evaluate("document.querySelectorAll('#documentResults .splitter-contract').length"), 2);
  await evaluate("document.querySelectorAll('#documentResults .splitter-contract')[1].querySelector('button').click()");
  await verifyPdf(await downloaded(downloadsMultiple, '1696 (2).pdf'), [1, 2, 3, 4]);
  await evaluate("document.getElementById('downloadAll').click()");
  const multipleZip = unzipSync(await downloaded(downloadsMultiple, 'document-splits.zip'));
  assert.equal(Object.keys(multipleZip).length, 8);
  for (const name of ['1696', '1693', '3288', '827']) {
    assert.ok(multipleZip[`${name}.pdf`]);
    assert.ok(multipleZip[`${name} (2).pdf`]);
  }
  for (const name of Object.keys(multipleZip)) assert(!/Private|Second|Client/.test(name));
  assert(requests.every(({ method }) => method === 'GET'), 'PDF contents must not be transmitted');
  const persistedData = await evaluate("JSON.stringify({ localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage } })");
  assert(!/Private Client|Second Client|CLIENT_DOCUMENT_CONTENT_CANARY/.test(persistedData), 'Client documents and filenames must not be persisted.');
  assert(!/Private Client|Second Client|CLIENT_DOCUMENT_CONTENT_CANARY/.test(consoleMessages.join('\n')), 'Client documents and filenames must not be logged to the console.');
  assert(requests.every(({ path }) => !/Private|Second|CANARY/.test(path)), 'Client documents and filenames must not appear in request URLs.');
  process.stdout.write('Document Splitter browser downloads passed: single, multiple, individual, ZIP.\n');
} finally {
  socket?.close();
  browser.kill();
  await new Promise(done => server.close(done));
  const absoluteTemporary = resolve(temporary);
  assert(absoluteTemporary.startsWith(resolve(tmpdir()) + sep), 'Temporary cleanup must stay within the OS temp directory.');
  await rm(absoluteTemporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
