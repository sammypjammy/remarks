// Click through the production build in real Chromium. No external APIs or sends.
// Run after npm.cmd run build: node tests/navigation-browser-check.mjs "C:\path\to\chrome.exe"
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname, sep } from "node:path";
import { spawn } from "node:child_process";
import { checkIntake } from "../intake-checker/browser-check.mjs";

const browser = process.argv[2];
assert(browser, "Provide a Chromium executable path");
const root = resolve("dist");
const failures = [];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".pdf": "application/pdf" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  // This server has no credentials or API handlers; any accidental API use fails.
  if (pathname.startsWith("/api/")) failures.push(`Unexpected API request: ${pathname}`);
  const path = resolve(root, `.${pathname.endsWith("/") ? pathname + "index.html" : pathname}`);
  try {
    assert(path.startsWith(root + sep));
    const content = await readFile(path);
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" });
    res.end(content);
  } catch {
    failures.push(`Missing resource: ${pathname}`);
    res.writeHead(404).end();
  }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "toolkit-navigation-"));
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
child.on("error", error => failures.push(error.message));
let socket;
const pause = () => new Promise(done => setTimeout(done, 50));
async function until(fn, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await pause();
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  let port;
  await until(async () => {
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; return port; }
    catch { return false; }
  }, "Chrome startup");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) {
      const promise = pending.get(event.id);
      pending.delete(event.id);
      event.error ? promise.reject(new Error(event.error.message)) : promise.resolve(event.result);
    }
    if (event.method === "Runtime.exceptionThrown") failures.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method === "Log.entryAdded" && event.params.entry.level === "error") failures.push(event.params.entry.text);
    if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") failures.push("Console error: " + event.params.args.map(arg => arg.value || arg.description).join(" "));
  };
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function loaded(path) {
    await until(async () => {
      try { return await evaluate(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && !!document.querySelector('.app-footer') && !!document.querySelector('main')`); }
      catch (error) { if (/context/i.test(error.message)) return false; throw error; }
    }, `load ${path}`);
  }
  async function visit(path) { await cdp("Page.navigate", { url: origin + path }); await loaded(path); }
  async function click(selector, path) {
    assert(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || !el.getClientRects().length) return false; el.click(); return true; })()`), `Visible link: ${selector}`);
    await loaded(path);
  }
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  const pages = ["/", "/med-tabs-generator/", "/canned-remarks/", "/welcome-email-sender/", "/fax-sender/", "/intake-checker/", "/settings/", "/version-history/"];
  for (const width of [1280, 390]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const page of pages) {
      await visit(page);
      assert(await evaluate(`document.querySelector('.app-footer').innerText.includes('${page === '/' ? 'Home Page v1.1.0' : page === '/canned-remarks/' ? 'Canned Remarks v2.9.0' : page === '/fax-sender/' ? 'Fax Sender v2.16.0' : page === '/welcome-email-sender/' ? 'Email Sender v2.6.0' : page === '/intake-checker/' ? 'Intake Checker v1.4.0' : 'Packard Toolkit v2.14.0'}')`), `Version on ${page}`);
      assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), `No horizontal overflow on ${page} at ${width}`);
      if (page === '/canned-remarks/') {
        await evaluate(`document.querySelector('a[href="#canned-version-history"]').click()`);
        assert(await evaluate("document.getElementById('canned-version-history').open"), "Canned Remarks has its own history");
      } else if (page === '/welcome-email-sender/') {
        await evaluate(`document.querySelector('.app-footer-links a[href="#email-version-history"]').click()`);
        assert(await evaluate("document.getElementById('email-version-history').open"), "Email version history is local to its footer");
      } else {
        await click('.app-footer a[href$="version-history/"]', "/version-history/");
        assert.equal(await evaluate("document.querySelector('h1').textContent"), "Version History");
        // Verify both the displayed version and the separate history link.
        await visit(page);
        await click('.app-footer-links a[href$="version-history/"]', "/version-history/");
      }
      await visit(page);
      await evaluate(`document.querySelector('.app-menu-toggle').click()`);
      await until(() => evaluate("!!document.querySelector('.toolkit-navigation') && document.querySelector('.toolkit-navigation').getClientRects().length > 0"), "menu open");
      assert(await evaluate(`![...document.querySelectorAll('.toolkit-navigation a')].some(a => a.href.includes('version-history')) && !document.querySelector('.toolkit-navigation').innerText.toLowerCase().includes('version history')`), "History excluded from primary menu");
      const links = await evaluate(`[...document.querySelectorAll('.toolkit-navigation a')].map(a => ({ href: a.getAttribute('href'), path: new URL(a.href).pathname }))`);
      const expectedLinks = page === "/version-history/" ? 7 : 6;
      assert.equal(links.length, expectedLinks, `Toolkit links on ${page}`);
      assert(await evaluate(`([...document.querySelectorAll('.toolkit-navigation a')].filter(a => /\\/(fax-sender|intake-checker)(\\/|$)/.test(new URL(a.href).pathname)).length + [...document.querySelectorAll('.toolkit-navigation .active')].filter(item => /Fax Sender|Intake Checker/.test(item.textContent)).length) === 2`), `Fax Sender and Intake Checker appear once on ${page}`);
      for (const link of links) {
        await visit(page);
        await evaluate(`document.querySelector('.app-menu-toggle').click()`);
        await until(() => evaluate(`!!document.querySelector('.toolkit-navigation a')`), "menu links");
        await click(`.toolkit-navigation a[href=${JSON.stringify(link.href)}]`, link.path);
      }
    }
    await visit("/settings/");
    await evaluate("localStorage.removeItem('packard-toolkit-homepage'); location.reload()");
    await loaded("/settings/");
    assert.equal(await evaluate("document.querySelectorAll('#homepageToolList [data-tool-id]').length"), 5, "Homepage settings show every tool");
    assert.equal(await evaluate("[...document.querySelectorAll('#homepageToolList .settings-toggle')].filter(button => button.getAttribute('aria-checked') === 'true').length"), 5, "Homepage tools default visible");
    assert(await evaluate("document.querySelector('#homepageName').value === '' && document.querySelector('#homepageTitle')"), "Homepage name defaults blank");
    assert(await evaluate("[...document.querySelectorAll('#homepageToolList .homepage-move-button')].every(button => !button.textContent.includes('Up') && !button.textContent.includes('Down') && button.title)"), "Homepage reorder controls use compact arrows");
    assert(await evaluate("document.querySelector('.toolkit-navigation').textContent.includes('Fax Sender') && document.querySelector('.toolkit-navigation').textContent.includes('Intake Checker')"), "Homepage settings do not remove navigation tools");
    await evaluate("document.querySelector('#homepageName').value = '  '; document.querySelector('#homepageName').dispatchEvent(new Event('input')); ");
    await visit("/");
    assert(await evaluate("document.getElementById('homeNamePrompt').hidden === false && document.getElementById('homeGreeting').textContent === 'Welcome to the Packard Toolkit.'"), "Blank homepage name shows prompt");
    await evaluate("document.getElementById('homeNamePrompt').click()");
    await loaded("/settings/");
    assert(await evaluate("location.hash === '#homepageTitle'"), "Homepage prompt opens Homepage settings");
    await evaluate("document.querySelector('#homepageName').value = 'Sam'; document.querySelector('#homepageName').dispatchEvent(new Event('input')); ");
    await visit("/");
    assert(await evaluate("document.getElementById('homeGreeting').textContent === 'Welcome, Sam.' && document.getElementById('homeNamePrompt').hidden"), "Homepage greeting uses saved name");
    await evaluate("location.reload()");
    await loaded("/");
    assert.equal(await evaluate("document.getElementById('homeGreeting').textContent"), "Welcome, Sam.", "Homepage name persists after refresh");
    await visit("/settings/");
    await evaluate("document.getElementById('emailSignature').value = 'Email Name\\nPosition\\nPhone'; document.getElementById('signatureForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))");
    await visit("/");
    assert.equal(await evaluate("document.getElementById('homeGreeting').textContent"), "Welcome, Sam.", "Email signature does not affect homepage greeting");
    await visit("/settings/");
    await evaluate("document.querySelector('#homepageToolList [data-tool-id=\\\"remarks\\\"] [data-homepage-move=\\\"down\\\"]').click()");
    await visit("/");
    assert.equal(await evaluate("document.querySelector('.tool-card:not([hidden]) strong').textContent"), "Med Tabs", "Homepage reorder applies");
    await visit("/settings/");
    assert.equal(await evaluate("document.querySelector('#homepageToolList [data-tool-id=\\\"remarks\\\"] .homepage-move-button[data-homepage-move=\\\"up\\\"]').disabled"), false, "Homepage order persists after navigation");
    for (const id of ["remarks", "med-tabs", "email", "fax", "intake"]) {
      await evaluate(`document.querySelector('#homepageToolList [data-tool-id=${JSON.stringify(id)}] .homepage-visibility-toggle').click()`);
      await visit("/");
      assert.equal(await evaluate(`document.querySelector('[data-home-tool=${JSON.stringify(id)}]').hidden`), true, `Homepage hides ${id}`);
      await visit("/settings/");
      await evaluate(`document.querySelector('#homepageToolList [data-tool-id=${JSON.stringify(id)}] .homepage-visibility-toggle').click()`);
    }
    await evaluate("document.querySelector('#homepageToolList [data-tool-id=\\\"fax\\\"] .homepage-visibility-toggle').click()");
    await visit("/");
    await evaluate("location.reload()");
    await loaded("/");
    assert.equal(await evaluate("document.querySelector('[data-home-tool=\\\"fax\\\"]').hidden"), true, "Homepage visibility applies");
    await evaluate("localStorage.setItem('packard-toolkit-homepage', JSON.stringify({version:999, order:['fax'], hidden:['remarks']})); location.reload()");
    await loaded("/");
    assert.equal(await evaluate("document.querySelectorAll('.tool-card:not([hidden])').length"), 5, "Invalid homepage preferences fall back safely");
    await evaluate("localStorage.setItem('packard-toolkit-homepage', JSON.stringify({version:1, order:['remarks'], hidden:['unknown']})); location.reload()");
    await loaded("/");
    assert.equal(await evaluate("document.querySelectorAll('.tool-card:not([hidden])').length"), 5, "Missing and unknown homepage tools use defaults");
    await visit("/settings/");
    await evaluate("document.getElementById('resetHomepage').click()");
    assert.equal(await evaluate("[...document.querySelectorAll('#homepageToolList .settings-toggle')].filter(button => button.getAttribute('aria-checked') === 'true').length"), 5, "Homepage reset restores visibility");
    await click('main a[href="../version-history/"]', "/version-history/");
    assert.equal(await evaluate("document.querySelectorAll('main article').length"), 24, "Current release plus all recorded historical releases");
    if (!process.argv.includes("--fax-only")) await checkIntake({ visit, click, evaluate, width, capture: async () => {
      const metrics = await cdp("Page.getLayoutMetrics");
      const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: metrics.cssContentSize.height, scale: 1 } });
      const path = join(profile, `intake-workspace-${width}.png`);
      await writeFile(path, Buffer.from(shot.data, "base64"));
      console.log(`Intake workspace screenshot: ${path}`);
    } });
    await visit("/fax-sender/");
    // Start each viewport with isolated history, then exercise real file-input events.
    await evaluate("localStorage.removeItem('packard.faxHistory.v1')");
    await visit("/fax-sender/");
    assert(await evaluate(`(() => {
      const destination = document.getElementById('contactSearch').getBoundingClientRect();
      const lastFour = document.getElementById('lastFourSsn').getBoundingClientRect();
      return innerWidth === ${width} && lastFour.width <= 140 && (innerWidth > 640
        ? Math.abs(destination.top - lastFour.top) < 1 && destination.width > lastFour.width * 2
        : lastFour.top >= destination.bottom);
    })()`), "Destination and compact Last 4 align responsively at actual viewport width");
    if (width === 1280) assert(await evaluate(`(() => {
      const history = document.getElementById('faxHistory').getBoundingClientRect();
      const form = document.querySelector('.fax-panel').getBoundingClientRect();
      return history.width > 450 && history.left >= form.right && form.width > history.width;
    })()`), "History is substantially wider than the old 300px sidebar while form remains primary");
    assert(await evaluate("!document.getElementById('version-history') && !document.getElementById('faxSendingInfo').open && document.querySelectorAll('#faxResult').length === 1"), "Fax UI remains streamlined");
    assert(await evaluate(`document.getElementById('faxHistory').open === (innerWidth >= 1100) && !document.getElementById('faxHistoryEmpty').hidden`), "Responsive history and empty state");
    assert(await evaluate("document.getElementById('includeCoverSheet').checked && !document.getElementById('includeCoverSheet').disabled && document.getElementById('coverSheetState').textContent.includes('RingCentral Classic')"), "Cover defaults ON");
    await evaluate("document.getElementById('includeCoverSheet').click()");
    assert(await evaluate("!document.getElementById('includeCoverSheet').checked && document.getElementById('coverSheetState').textContent.includes('OFF')"), "Cover can be turned OFF");
    await evaluate("document.getElementById('includeCoverSheet').click()");
    assert(await evaluate("!document.getElementById('coverCommentField').hidden && !document.getElementById('coverPageText').disabled && document.getElementById('coverPageText').value === '' && !document.getElementById('coverPageText').required && document.getElementById('coverPageText').maxLength === 1024"), "Optional comment starts blank and visible");
    await evaluate("document.getElementById('coverPageText').value = 'Reset me'; document.getElementById('coverPageText').dispatchEvent(new Event('input')); document.getElementById('clearAll').click()");
    assert(await evaluate("document.getElementById('coverPageText').value === '' && document.getElementById('includeCoverSheet').checked"), "Clear resets comment-only batch");
    await evaluate("document.getElementById('coverPageText').value = '  Synthetic batch comment  '; document.getElementById('coverPageText').dispatchEvent(new Event('input')); document.getElementById('includeCoverSheet').click()");
    assert(await evaluate("document.getElementById('coverCommentField').hidden && document.getElementById('coverPageText').disabled"), "OFF hides and disables stale comment");
    await evaluate("document.getElementById('includeCoverSheet').click()");
    assert(await evaluate("!document.getElementById('lastFourHelp') && document.getElementById('lastFourSsn').required && !document.getElementById('lastFourSsn').hasAttribute('aria-describedby')"), "SSN helper removed while required validation remains");
    assert(await evaluate("document.querySelector('.fax-cover-sheet').getBoundingClientRect().height <= 48 && document.querySelector('.fax-cover-sheet label').getBoundingClientRect().height >= 44 && parseFloat(getComputedStyle(document.querySelector('.fax-cover-sheet')).marginTop) === 0"), "Compact cover row retains a tappable label");
    // Exercise the built app with mock sends; never contact RingCentral.
    await evaluate(`(() => {
      let id = 0;
      window.faxSubmissions = [];
      globalThis.fetch = async (url, options) => {
        if (url === '/api/ringcentral-contacts') return Response.json({success:true, contacts:[]});
        if (url === '/api/send-fax' && options.method === 'POST') { window.faxSubmissions.push(options.body); return Response.json({success:true, messageId:String(++id), status:'Sent'}); }
        if (url.startsWith('/api/fax-message')) { const messageId = new URL(url, location.origin).searchParams.get('messageId'); return Response.json({success:true, messageId, receiptNote:'Receipt available', attachments:[{type:'RenderedDocument', downloadUrl:'/api/fax-attachment?messageId='+messageId+'&attachmentId='+messageId, fileName:'RenderedDocument.pdf', contentType:'application/pdf'}]}); }
        throw new Error('Unexpected mock request');
      };
      const search = document.getElementById('contactSearch');
      search.value = '8015551234'; search.dispatchEvent(new Event('input'));
    })()`);
    await until(() => evaluate("!!document.querySelector('#contactResults button')"), "manual destination");
    await evaluate(`document.querySelector('#contactResults button').click();
      const transfer = new DataTransfer();
      transfer.items.add(new File(['%PDF-1.4'], 'example.pdf', {type:'application/pdf'}));
      document.getElementById('pdfFile').files = transfer.files;
      document.getElementById('pdfFile').dispatchEvent(new Event('change'));`);
    await until(() => evaluate("!document.getElementById('sendFax').disabled"), "PDF validated");
    assert(await evaluate(`document.querySelectorAll('#documentList .fax-filename').length === 1 && document.querySelector('.fax-filename').textContent === 'example.pdf' && getComputedStyle(document.getElementById('pdfFile')).display === 'none' && document.getElementById('choosePdfFiles').innerText === 'Choose PDF Files'`), "Custom selection control hides native empty filename display; one file appears only in document list");
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      for (const name of ['second.pdf', 'remove.pdf']) transfer.items.add(new File(['%PDF-1.4'], name, {type:'application/pdf'}));
      document.getElementById('pdfFile').files = transfer.files;
      document.getElementById('pdfFile').dispatchEvent(new Event('change'));
    })()`);
    await until(() => evaluate("document.querySelectorAll('#documentList li').length === 3 && !document.getElementById('choosePdfFiles').disabled"), "multiple selection appended");
    await evaluate(`document.querySelector('[aria-label="Remove remove.pdf"]').click()`);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.fax-filename')].map(el => el.textContent)"), ['example.pdf', 'second.pdf'], "Remove preserves order and one filename per document");
    for (const invalid of ['', '123', '12345', '21A4']) {
      await evaluate(`document.getElementById('lastFourSsn').value = ${JSON.stringify(invalid)}; document.getElementById('lastFourSsn').dispatchEvent(new Event('input')); document.getElementById('faxForm').dispatchEvent(new Event('submit', {cancelable:true}));`);
      assert.equal(await evaluate("window.faxSubmissions.length"), 0, "Invalid Last 4 causes zero fax submissions");
    }
    await evaluate("document.getElementById('lastFourSsn').value = '0007'; document.getElementById('lastFourSsn').dispatchEvent(new Event('input'))");
    await evaluate("document.getElementById('sendFax').click()");
    await until(() => evaluate("document.getElementById('faxHistoryList').textContent.includes('Sent')"), "sent fax in history");
    await until(() => evaluate("window.faxSubmissions.length === 2 && !document.getElementById('clearAll').disabled"), "both files sent sequentially");
    assert.deepEqual(await evaluate("window.faxSubmissions.map(body => ({name:body.get('file').name, fields:[...body.keys()]}))"), [{name:'example.pdf',fields:['faxNumber','file','includeCoverSheet','coverPageText']},{name:'second.pdf',fields:['faxNumber','file','includeCoverSheet','coverPageText']}], "Original files remain associated with ordered submissions; Last 4 never sent");
    assert(await evaluate("window.faxSubmissions.every(body => body.get('includeCoverSheet') === 'true') && document.getElementById('includeCoverSheet').disabled"), "Every fax requests a cover and batch choice locks");
    assert(await evaluate("window.faxSubmissions.every(body => body.get('coverPageText') === 'Synthetic batch comment') && document.getElementById('coverPageText').disabled && !JSON.stringify(localStorage).includes('Synthetic batch comment') && !JSON.stringify(sessionStorage).includes('Synthetic batch comment')"), "Comment snapshots lock and do not persist");
    assert(await evaluate("JSON.parse(localStorage.getItem('packard.faxHistory.v1')).every(entry => entry.lastFourSsn === '0007')"), "Last 4 persists only in its attempt history record");
    await until(() => evaluate("!![...document.querySelectorAll('#documentList button')].find(button => button.textContent === 'Download Fax Receipt')"), "receipt action");
    assert(await evaluate("document.querySelector('#documentList button.primary-btn')?.textContent === 'Download Fax Receipt'"), "Sent card exposes primary receipt action");
    await evaluate("document.getElementById('faxHistory').open = true; document.activeElement.blur()");
    assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "Populated fax history must fit viewport");
    assert(await evaluate(`(() => {
      const button = document.getElementById('reloadContacts').getBoundingClientRect();
      const icon = document.querySelector('#reloadContacts svg').getBoundingClientRect();
      return button.right <= innerWidth && Math.abs(button.x + button.width/2 - icon.x - icon.width/2) < 1;
    })()`), "Refresh icon fits and centers at actual viewport width");
    // Stress the existing history spacing without changing application state.
    await evaluate(`(() => {
      const row = document.querySelector('#faxHistoryList li');
      row.querySelector('.fax-history-meta span').textContent = 'Regional Social Security Office — Long Contact Name for Layout Verification';
      row.querySelector('.fax-history-title').textContent = 'Long_original_document_filename_for_history_wrapping_and_spacing_verification.pdf 0007';
    })()`);
    assert(await evaluate("document.documentElement.scrollWidth <= innerWidth && document.getElementById('faxHistoryList').scrollWidth <= document.getElementById('faxHistoryList').clientWidth"), "Long contact names and filenames wrap within history");
    const metrics = await cdp("Page.getLayoutMetrics");
    const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: metrics.cssContentSize.height, scale: 1 } });
    const screenshotPath = join(profile, `fax-history-${width}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.log(`Fax History screenshot: ${screenshotPath}`);
    await evaluate("window.savedBeforeReset = localStorage.getItem('packard.faxHistory.v1'); window.historyPill = document.querySelector('#faxHistoryList details'); window.historyPill.open = true; document.getElementById('clearAll').click()");
    assert(await evaluate("localStorage.getItem('packard.faxHistory.v1') === window.savedBeforeReset && document.querySelectorAll('#faxHistoryList li').length === 2 && window.historyPill.isConnected && window.historyPill.open"), "Clear All preserves exact persisted history and expanded pills");
    assert(await evaluate("document.getElementById('contactSearch').value === '' && document.getElementById('faxNumber').value === '' && document.getElementById('lastFourSsn').value === '' && document.getElementById('coverPageText').value === '' && document.getElementById('includeCoverSheet').checked && !document.getElementById('includeCoverSheet').disabled && !document.querySelector('#documentList li') && document.getElementById('pdfFile').files.length === 0 && document.getElementById('faxResult').hidden && document.getElementById('batchReceipts').hidden"), "Clear All resets only current fax form, files, cover settings and results");
    await visit('/fax-sender/');
    assert.equal(await evaluate("document.querySelectorAll('#faxHistoryList li').length"), 2, "History restores on navigation");
    assert.equal(await evaluate("document.getElementById('lastFourSsn').value"), '', "Active input is not restored from persisted attempt Last 4");
    await evaluate(`(() => {
      const records = JSON.parse(localStorage.getItem('packard.faxHistory.v1'));
      records[0].recipientName = 'Regional Social Security Office with a long contact name';
      records[0].filename = 'Long_original_document_filename_for_history_layout.pdf';
      records.push({...records[0], filename:'Legacy.pdf', lastFourSsn:undefined, messageId:'91'});
      records.push({...records[0], filename:'Failed.pdf', state:'Failed', status:'SendingFailed', messageId:'92'});
      records.push({...records[0], filename:'Unknown.pdf', state:'Status Unknown', status:'Queued', messageId:'93'});
      for (let i = 0; i < 15; i++) records.push({...records[0], filename:'Older-'+i+'.pdf', messageId:String(100+i)});
      localStorage.setItem('packard.faxHistory.v1', JSON.stringify(records));
    })()`);
    await visit('/fax-sender/');
    assert(await evaluate("document.getElementById('includeCoverSheet').checked"), "Reload resets cover ON");
    assert(await evaluate("document.getElementById('coverPageText').value === ''"), "Reload clears comment");
    await evaluate(`document.getElementById('faxHistory').open = true;
      window.historyRequests = []; window.receiptDownloads = []; window.failHistoryReceipt = false;
      HTMLAnchorElement.prototype.click = function() { window.receiptDownloads.push(this.download); };
      globalThis.fetch = async (url, options) => {
        window.historyRequests.push({url, method:options?.method || 'GET'});
        if (window.failHistoryReceipt) return Response.json({success:false}, {status:502});
        const id = new URL(url, location.origin).searchParams.get('messageId');
        if (url.startsWith('/api/fax-message?')) return Response.json({success:true,messageId:id,attachments:[{type:'RenderedDocument',downloadUrl:'/api/fax-attachment?messageId='+id+'&attachmentId='+id}]});
        if (url.startsWith('/api/fax-attachment?')) return new Response('%PDF-history');
        throw new Error('Unexpected history request');
      };`);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.fax-history-status')].slice(0,5).map(el => el.textContent)"), ['Sent','Sent','Sent','Error','Status Unknown'], "Sent/Error/neutral history labels");
    assert(await evaluate("[...document.querySelectorAll('#faxHistoryList details')].every(el => !el.open) && document.querySelector('.fax-history-title').textContent.endsWith('0007') && document.querySelector('.fax-history-meta').textContent.includes('Regional Social Security') && !!document.querySelector('.fax-history-meta time').dateTime"), "Collapsed title, Last 4, recipient, date hierarchy");
    assert(await evaluate("document.querySelectorAll('#faxHistoryList li')[2].querySelector('.fax-history-title').textContent === 'Legacy.pdf' && document.querySelectorAll('#faxHistoryList li')[3].querySelector('button').hidden"), "Legacy Last 4 omitted and failed receipt unavailable");
    await evaluate("document.querySelector('#faxHistoryList summary').focus()");
    await cdp('Input.dispatchKeyEvent', {type:'keyDown', key:'Enter', code:'Enter', text:'\r', windowsVirtualKeyCode:13});
    await cdp('Input.dispatchKeyEvent', {type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13});
    await until(() => evaluate("document.querySelector('#faxHistoryList details').open"), "Native disclosure supports keyboard activation and expanded state");
    await evaluate("document.querySelector('#faxHistoryList summary').click()");
    assert(await evaluate("!document.querySelector('#faxHistoryList details').open"), "Click collapses native disclosure");
    await evaluate("document.querySelector('#faxHistoryList summary').click(); document.querySelector('#faxHistoryList button').click()");
    await until(() => evaluate("window.receiptDownloads.length === 1"), "History receipt after refresh");
    assert.equal(await evaluate("window.receiptDownloads[0]"), 'Fax Receipt - Long_original_document_filename_for_history_layout 0007.pdf', "History receipt uses original name and persisted Last 4");
    assert.deepEqual(await evaluate("window.historyRequests"), [{url:'/api/fax-message?messageId=2',method:'GET'},{url:'/api/fax-attachment?messageId=2&attachmentId=2',method:'GET'}], "Exact stored message ID, shared endpoints, no SSN or fax submission");
    await evaluate("document.querySelector('#faxHistoryList button').click()");
    await until(() => evaluate("window.receiptDownloads.length === 2"), "History cache reuse");
    assert.equal(await evaluate("window.historyRequests.length"), 2, "Repeated download reuses in-memory metadata/blob");
    await evaluate("document.querySelectorAll('#faxHistoryList summary')[2].click(); document.querySelectorAll('#faxHistoryList li')[2].querySelector('button').click()");
    await until(() => evaluate("window.receiptDownloads.length === 3"), "Legacy receipt");
    assert.equal(await evaluate("window.receiptDownloads[2]"), 'Fax Receipt - Legacy.pdf', "Legacy safe filename needs no SSN prompt");
    await evaluate("window.failHistoryReceipt = true; document.querySelectorAll('#faxHistoryList summary')[1].click(); document.querySelectorAll('#faxHistoryList li')[1].querySelector('button').click()");
    await until(() => evaluate("document.querySelectorAll('#faxHistoryList li')[1].querySelector('[role=status]').textContent.includes('unavailable')"), "History lookup failure feedback");
    assert(await evaluate("document.querySelectorAll('.fax-history-status')[1].textContent === 'Sent' && window.historyRequests.every(req => req.method === 'GET')"), "Receipt errors never change Sent or resend fax");
    assert(await evaluate("document.documentElement.scrollWidth <= innerWidth && document.querySelector('#faxHistoryList button').getBoundingClientRect().height >= 44"), "Expanded content fits and receipt control is tappable");
    const dimensions = await evaluate(`(() => {
      const list = document.getElementById('faxHistoryList');
      const heading = document.querySelector('#faxHistory > summary');
      list.scrollTop = list.scrollHeight;
      const scrolled = list.scrollTop > 0;
      const last = list.lastElementChild.querySelector('details'); last.open = true;
      last.querySelector('button').scrollIntoView({block:'nearest'});
      const button = last.querySelector('button').getBoundingClientRect();
      const box = list.getBoundingClientRect();
      // Browser scrolling rounds offsets to whole pixels; layout rectangles remain fractional.
      const accessible = button.top >= box.top - 1 && button.bottom <= box.bottom + 1;
      const stableHeading = heading.getBoundingClientRect().top;
      list.scrollTop = 0;
      return {width:document.getElementById('faxHistory').getBoundingClientRect().width,height:list.clientHeight, count:list.children.length,scrolled,accessible,buttonTopInset:button.top-box.top,buttonBottomInset:box.bottom-button.bottom,internal:heading.getBoundingClientRect().top===stableHeading,overflow:getComputedStyle(list).overflowY,horizontal:list.scrollWidth>list.clientWidth};
    })()`);
    assert.equal(dimensions.count,20); assert(dimensions.scrolled && dimensions.accessible && dimensions.internal && !dimensions.horizontal, JSON.stringify(dimensions));
    assert.equal(dimensions.overflow,'auto'); assert(dimensions.height >= 300 && dimensions.height <= 640);
    console.log('History dimensions ('+width+'px): '+JSON.stringify(dimensions));
    const historyMetrics = await cdp('Page.getLayoutMetrics');
    const historyShot = await cdp('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:historyMetrics.cssContentSize.height,scale:1}});
    const historyPath = join(profile, 'fax-history-expanded-' + width + '.png');
    await writeFile(historyPath, Buffer.from(historyShot.data, 'base64'));
    console.log('Expanded history screenshot: ' + historyPath);
    await evaluate("window.savedHistory = localStorage.getItem('packard.faxHistory.v1'); document.getElementById('clearAll').click()");
    assert(await evaluate("document.querySelectorAll('#faxHistoryList li').length === 20 && localStorage.getItem('packard.faxHistory.v1') === window.savedHistory"), "Clear All preserves history even with no current documents");
    await evaluate("window.failHistoryReceipt = false; document.querySelector('#faxHistoryList button').click()");
    await until(() => evaluate("window.receiptDownloads.length === 4"), "History receipt remains available after reset");
    console.log(`PASS (${width}px): Settings/history, footer links on all 8 pages, released-tool menus, hidden development tools with working direct URLs, no overflow.`);
  }
  assert.deepEqual(failures, [], "No missing resources, unexpected API calls, console or runtime errors");
  console.log("PASS: no broken resources, console/runtime errors, or API calls.");
} finally {
  socket?.close();
  child.kill();
  server.close();
}
