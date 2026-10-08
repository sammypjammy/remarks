// Synthetic fixtures only. Local production server; no external services or credentials.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { syntheticPdf } from './synthetic-pdf.mjs';
import { readinessIntake, checkReadiness } from './readiness-browser-check.mjs';

const browserPath = process.argv[2];
assert(browserPath, 'Provide Chrome executable');
const directory = await mkdtemp(join(tmpdir(), 'ssa-workflow-synthetic-'));
const root = resolve('dist');
let authenticated = true;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.gz': 'application/octet-stream' };
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push({ url: req.url, method: req.method });
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/api/auth/session') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(url.searchParams.has('preferences') ? { accountId: authenticated ? 'synthetic' : null, values: null } : { authenticated, user: { displayName: 'Synthetic Employee' } }));
  }
  if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
  if (url.pathname.startsWith('/api/')) return res.writeHead(500).end();
  try {
    const path = resolve(root, '.' + (url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
    assert(path.startsWith(root + sep));
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const child = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let launchError;
child.on('error', error => { launchError = error; });
let socket;
async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (launchError) throw launchError;
    if (await fn()) return;
    await new Promise(done => setTimeout(done, 50));
  }
  throw new Error('Synthetic browser condition timed out');
}
const failures = [];
const network = [];
try {
  let port;
  await until(async () => { try { port = (await readFile(join(directory, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0]; return port; } catch { return false; } });
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(done => { socket.onopen = done; });
  const pending = new Map(); let id = 0;
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) { const call = pending.get(event.id); pending.delete(event.id); event.error ? call.reject(Error(event.error.message)) : call.resolve(event.result); }
    if (event.method === 'Runtime.exceptionThrown') failures.push('Runtime exception');
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') failures.push('Console error');
    if (event.method === 'Network.requestWillBeSent') network.push(event.params.request);
  };
  function cdp(method, params = {}) { return new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, 'Synthetic browser evaluation failed');
    return result.result.value;
  }
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  async function visit(path) {
    await cdp('Page.navigate', { url: origin + path });
    await until(() => evaluate(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && !!document.querySelector('.toolkit-auth-name')`));
  }
  async function click(text) {
    assert(await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(text)}); if (!button) return false; button.click(); return true; })()`));
  }
  async function check(text) {
    await evaluate(`document.getElementById('intakeText').value = ${JSON.stringify(text)}; document.querySelector('#intakeForm button[type=submit]').click()`);
  }
  const intake = readinessIntake;
  await checkReadiness({ cdp, evaluate, visit, click, check, until, network, origin, directory });
  authenticated = false;
  await visit('/intake-checker/'); await check(intake);
  await evaluate("document.querySelectorAll('#validationIssues .intake-reviewed, #reviewItems .intake-reviewed').forEach(button => button.click())");
  await click('Continue to SSA Intake Assistant');
  await until(() => evaluate("!document.getElementById('intakeText').value && document.getElementById('ssaIntakeView').hidden"));
  await visit('/ssa-intake-assistant/');
  await until(() => evaluate("document.body.textContent.includes('Sign in to the Toolkit to use SSA Intake Assistant')"));
  assert(!await evaluate("!!document.querySelector('input[type=file]')"));
  authenticated = true;
  await visit('/ssa-intake-assistant/');
  await until(() => evaluate("!!document.querySelector('input[type=file]')"));
  await until(() => evaluate("PackardSettings.accountPreferencesStatus() === 'saved'"));
  const pdfStorage = await evaluate('JSON.stringify([localStorage, sessionStorage])');
  await evaluate("window.pdfWrites = 0; const save = Storage.prototype.setItem; Storage.prototype.setItem = function(...args) { window.pdfWrites++; return save.apply(this, args); }; indexedDB.open = () => { window.pdfWrites++; throw Error('No client database'); }");
  async function upload(bytes) {
    await evaluate(`(() => { const data = Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0)); const files = new DataTransfer(); files.items.add(new File([data], 'synthetic.pdf', { type: 'application/pdf' })); const input = document.querySelector('input[type=file]'); input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await until(() => evaluate("!!document.getElementById('first-name')"), 120000);
    assert.equal(await evaluate("document.getElementById('first-name').value"), 'Example');
    assert(await evaluate("document.querySelector('.field-meta').textContent.includes('PDF page 1')"));
  }
  await upload(syntheticPdf());
  await click('Clear profile');
  // Draw a clearly synthetic scan locally; embed only JPEG pixels, with no PDF text layer.
  const jpeg = Buffer.from(await evaluate(`(() => { const canvas = document.createElement('canvas'); canvas.width = 1224; canvas.height = 1584; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,1224,1584); ctx.fillStyle = 'black'; ctx.font = '28px Arial'; ${JSON.stringify(['First Name: Example', 'Last Name: Sample', 'Social Security Number: 000-12-3456', 'Date of Birth: 1/1/2000', 'Phone Number: (210) 555-0142', 'Mailing Address - Street Address: 1 Example Road', 'Mailing Address - City: Sampletown', 'Mailing Address - State: TX', 'Mailing Address - ZIP Code: 00000'])}.forEach((line, i) => ctx.fillText(line, 70, 90 + i*65)); return canvas.toDataURL('image/jpeg', 0.98).split(',')[1]; })()`), 'base64');
  const drawing = 'q 612 0 0 792 0 0 cm /Im0 Do Q';
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'), Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'), Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1224 /Height 1584 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]), Buffer.from(`<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`)];
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.concat(chunks).length); chunks.push(Buffer.from(`${i+1} 0 obj\n`), object, Buffer.from('\nendobj\n')); });
  const xref = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10,'0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  const scan = Buffer.concat(chunks);
  const { extractPdfPages } = await import('../src/pdf/extractPdfCore.js');
  const extracted = await extractPdfPages(new Blob([scan], { type: 'application/pdf' }));
  assert.equal(extracted.diagnostics.textItemCount, 0);
  await upload(scan);
  assert(await evaluate("document.querySelector('.extraction-summary').textContent.includes('Local OCR recognized text on 1 page')"));
  assert.equal(await evaluate("[...document.querySelectorAll('.review-field > input')].filter(input => input.value).length"), 9);
  for (const [id, value] of Object.entries({ 'first-name': 'Example', 'last-name': 'Sample', 'social-security-number': '000-12-3456', 'date-of-birth': '1/1/2000', 'primary-phone': '(210) 555-0142', 'mailing-street': '1 Example Road', city: 'Sampletown', state: 'TX', 'zip-code': '00000' })) {
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}).value`), value);
    assert(await evaluate(`document.getElementById(${JSON.stringify(id)}).closest('.review-field').querySelector('.field-meta').textContent.includes('PDF page 1')`));
  }
  assert.equal(await evaluate('JSON.stringify([localStorage, sessionStorage])'), pdfStorage);
  assert.equal(await evaluate('window.pdfWrites'), 0);
  assert(network.every(request => (request.url.startsWith(origin + '/') || request.url.startsWith('blob:') || request.url.startsWith('data:')) && !request.postData));
  assert(requests.every(request => request.method === 'GET'));
  assert.deepEqual(failures, []);
  console.log('PASS: authentication, direct PDF, image-only local OCR (9 fields, page 1), same-origin GET assets only');
  await visit('/intake-checker/'); await check(intake);
  await evaluate("document.querySelectorAll('#validationIssues .intake-reviewed, #reviewItems .intake-reviewed').forEach(button => button.click())");
  await click('Continue to SSA Intake Assistant');
  await until(() => evaluate("!!document.querySelector('.ssa-client-filing')"));
  await until(() => evaluate("[...document.querySelectorAll('.ssa-client-filing button')].some(button => button.textContent === 'Open SSA application')"));
  await evaluate(`(() => {
    const input = document.getElementById('ssaReentryNumber');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'SYNTHETIC-REENTRY');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click('Open SSA application');
  await until(() => evaluate("document.querySelector('.live-launch [role=status]').textContent.includes('supported Toolkit page')"));
  assert(requests.every(request => request.method === 'GET'));
  const stopped = once(child, 'exit');
  await cdp('Browser.close'); await stopped; socket.close();
  const reopened = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(directory, 'profile')}`, '--dump-dom', '--virtual-time-budget=3000', origin + '/intake-checker/'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let dom = '';
  reopened.stdout.setEncoding('utf8'); reopened.stdout.on('data', data => { dom += data; });
  const [exit] = await once(reopened, 'exit'); assert.equal(exit, 0);
  assert.match(dom, /<textarea[^>]*id="intakeText"[^>]*><\/textarea>/);
  assert.match(dom, /id="continueToSsa"[^>]*hidden/);
  assert(!dom.includes('000-12-3456') && !dom.includes('synthetic@example.test'));
  console.log('PASS: closing and reopening Chrome with the same browser profile restores no intake/profile');
  console.log(`Synthetic screenshots: ${directory}`);
} finally {
  socket?.close(); child.kill(); server.closeAllConnections(); server.close();
}
