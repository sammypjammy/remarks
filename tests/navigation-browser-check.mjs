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
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true });
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
  const pages = ["/", "/med-tabs-generator/", "/canned-remarks/", "/welcome-email-sender/", "/fax-sender/", "/intake-checker/", "/settings/", "/version-history/"];
  for (const width of [1280, 390]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const page of pages) {
      await visit(page);
      assert(await evaluate(`document.querySelector('.app-footer').innerText.includes('Packard Toolkit v2.9.1')`), `Version on ${page}`);
      assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), `No horizontal overflow on ${page} at ${width}`);
      await click('.app-footer a[href$="version-history/"]', "/version-history/");
      assert.equal(await evaluate("document.querySelector('h1').textContent"), "Version History");
      // Verify both the displayed version and the separate history link.
      await visit(page);
      await click('.app-footer-links a[href$="version-history/"]', "/version-history/");
      await visit(page);
      await evaluate(`document.querySelector('.app-menu-toggle').click()`);
      await until(() => evaluate("!!document.querySelector('.toolkit-navigation') && document.querySelector('.toolkit-navigation').getClientRects().length > 0"), "menu open");
      assert(await evaluate(`![...document.querySelectorAll('.toolkit-navigation a')].some(a => a.href.includes('version-history')) && !document.querySelector('.toolkit-navigation').innerText.toLowerCase().includes('version history')`), "History excluded from primary menu");
      const links = await evaluate(`[...document.querySelectorAll('.toolkit-navigation a')].map(a => ({ href: a.getAttribute('href'), path: new URL(a.href).pathname }))`);
      assert.equal(links.length, page === "/version-history/" ? 7 : 6, `All other tools linked from ${page}`);
      for (const link of links) {
        await visit(page);
        await evaluate(`document.querySelector('.app-menu-toggle').click()`);
        await until(() => evaluate(`!!document.querySelector('.toolkit-navigation a')`), "menu links");
        await click(`.toolkit-navigation a[href=${JSON.stringify(link.href)}]`, link.path);
      }
    }
    await visit("/settings/");
    await click('main a[href="../version-history/"]', "/version-history/");
    assert.equal(await evaluate("document.querySelectorAll('main article').length"), 10, "Current release plus all nine recorded historical releases");
    await checkIntake({ visit, click, evaluate, width });
    await visit("/fax-sender/");
    assert(await evaluate("!document.getElementById('version-history') && !document.getElementById('faxSendingInfo').open && document.querySelectorAll('#faxResult').length === 1"), "Fax UI remains streamlined");
    assert(await evaluate(`document.getElementById('faxHistory').open === (innerWidth >= 1100) && !document.getElementById('faxHistoryEmpty').hidden`), "Responsive history and empty state");
    // Exercise the built app with mock sends; never contact RingCentral.
    await evaluate(`(() => {
      let id = 0;
      globalThis.fetch = async (url, options) => {
        if (url === '/api/ringcentral-contacts') return Response.json({success:true, contacts:[]});
        if (url === '/api/send-fax' && options.method === 'POST') return Response.json({success:true, messageId:String(++id), status:'Sent'});
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
    await evaluate("document.getElementById('sendFax').click()");
    await until(() => evaluate("document.getElementById('faxHistoryList').textContent.includes('Sent')"), "sent fax in history");
    await evaluate("document.getElementById('faxHistory').open = true; document.activeElement.blur()");
    assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "Populated fax history must fit viewport");
    assert(await evaluate(`(() => {
      const button = document.getElementById('reloadContacts').getBoundingClientRect();
      const icon = document.querySelector('#reloadContacts svg').getBoundingClientRect();
      return button.right <= innerWidth && Math.abs(button.x + button.width/2 - icon.x - icon.width/2) < 1;
    })()`), "Refresh icon fits and centers at actual viewport width");
    const metrics = await cdp("Page.getLayoutMetrics");
    const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: metrics.cssContentSize.height, scale: 1 } });
    const screenshotPath = join(profile, `fax-history-${width}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    console.log(`Fax History screenshot: ${screenshotPath}`);
    console.log(`PASS (${width}px): Settings/history, both footer links on all 8 pages, every primary-menu link including Email → Fax, no inline history, no overflow.`);
  }
  assert.deepEqual(failures, [], "No missing resources, unexpected API calls, console or runtime errors");
  console.log("PASS: no broken resources, console/runtime errors, or API calls.");
} finally {
  socket?.close();
  child.kill();
  server.close();
}
