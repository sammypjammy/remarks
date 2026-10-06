// Click through the production build in real Chromium. No external APIs or sends.
// Run after npm.cmd run build: node tests/navigation-browser-check.mjs "C:\path\to\chrome.exe"
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname, sep } from "node:path";
import { spawn } from "node:child_process";
import { checkIntake } from "./intake-browser-check.mjs";

const browser = process.argv[2];
assert(browser, "Provide a Chromium executable path");
const root = resolve("dist");
const failures = [];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".pdf": "application/pdf" };
let authenticated = true;
const preferences = (await import('./helpers/preference-api.js')).preferenceApi();
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === '/api/auth/session') {
    if (await preferences(req, res, authenticated ? 'synthetic-user' : null)) return;
    const session = authenticated ? { authenticated: true, user: { displayName: "Authenticated Test User" } } : { authenticated: false };
    res.writeHead(authenticated ? 200 : 401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(session));
  }
  if (pathname === '/api/ringcentral/connection') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ state: 'disconnected' }));
  }
  if (pathname === "/__homepage-reopen-check") {
    res.writeHead(302, { Location: "/" });
    return res.end();
  }
  if (pathname === '/favicon.ico') return res.writeHead(204).end();
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
      if (!promise) return;
      event.error ? promise.reject(new Error(event.error.message)) : promise.resolve(event.result);
    }
    if (event.method === "Runtime.exceptionThrown") failures.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method === "Log.entryAdded" && event.params.entry.level === "error") {
      const entry = event.params.entry;
      const expectedSignedOut = entry.url?.endsWith('/api/auth/session') && entry.text.includes('401');
      if (!expectedSignedOut) failures.push(entry.text);
    }
    if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") failures.push("Console error: " + event.params.args.map(arg => arg.value || arg.description).join(" "));
  };
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
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
    if (authenticated) await until(() => evaluate("PackardSettings.accountPreferencesStatus() === 'saved'"), `account preferences loaded on ${path}`);
  }
  async function visit(path) { await evaluate("window.PackardSettings?.flushPreferences()"); await cdp("Page.navigate", { url: origin + path }); await loaded(path); }
  async function click(selector, path) {
    await evaluate("window.PackardSettings?.flushPreferences()");
    assert(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || !el.getClientRects().length) return false; el.click(); return true; })()`), `Visible link: ${selector}`);
    await loaded(path);
  }
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  const pages = ["/", "/med-tabs-generator/", "/canned-remarks/", "/welcome-email-sender/", "/fax-sender/", "/intake-checker/", "/ssa-intake-assistant/", "/settings/", "/version-history/"];
  const defaultMenuOrder = ["Home", "Canned Remarks", "Med Tabs", "Welcome Emails", "Fax Sender", "Intake Checker", "SSA Intake Assistant", "Settings"];
  for (const width of [1280, 390]) {
    authenticated = true;
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const page of pages) {
      await visit(page);
      assert(await evaluate(`document.querySelector('.app-footer').innerText.includes('${page === '/' ? 'Home Page v1.3.1' : page === '/canned-remarks/' ? 'Canned Remarks v2.11.0' : page === '/fax-sender/' ? 'Fax Sender v3.3.1' : page === '/welcome-email-sender/' ? 'Email Sender v2.8.0' : page === '/intake-checker/' ? 'Intake Checker v1.11.0' : page === '/ssa-intake-assistant/' ? 'SSA Intake Assistant v1.7.0' : 'Packard Toolkit'}')`), `Version on ${page}`);
      if (page === '/fax-sender/') assert(await evaluate("document.getElementById('faxWorkspace').hidden"), "Disconnected users cannot use the fax workspace");
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
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.toolkit-navigation .toolkit-nav-item')].map(item => item.querySelector(':scope > span')?.textContent.trim() || item.textContent.trim())`), defaultMenuOrder, `Default tool order on ${page}`);
      const expectedLinks = page === "/version-history/" ? defaultMenuOrder.length : defaultMenuOrder.length - 1;
      assert.equal(links.length, expectedLinks, `Toolkit links on ${page}`);
      assert(await evaluate(`([...document.querySelectorAll('.toolkit-navigation a')].filter(a => /\\/(fax-sender|intake-checker)(\\/|$)/.test(new URL(a.href).pathname)).length + [...document.querySelectorAll('.toolkit-navigation .active')].filter(item => /Fax Sender|Intake Checker/.test(item.textContent)).length) === 2`), `Fax Sender and Intake Checker appear once on ${page}`);
      assert.equal(await evaluate(`([...document.querySelectorAll('.toolkit-navigation a')].filter(a => a.textContent.trim() === 'Fax Sender' && new URL(a.href).pathname === '/fax-sender/').length + [...document.querySelectorAll('.toolkit-navigation .active')].filter(a => a.textContent.trim().startsWith('Fax Sender')).length)`), 1, `One canonical Fax Sender navigation item on ${page}`);
      for (const link of links) {
        await visit(page);
        await evaluate(`document.querySelector('.app-menu-toggle').click()`);
        await until(() => evaluate(`!!document.querySelector('.toolkit-navigation a')`), "menu links");
        await click(`.toolkit-navigation a[href=${JSON.stringify(link.href)}]`, link.path);
      }
    }
    await visit("/settings/");
    await evaluate("(async () => { PackardSettings.resetHomepagePreferences(); await PackardSettings.flushPreferences(); location.reload() })()");
    await loaded("/settings/");
    assert.equal(await evaluate("document.querySelectorAll('#homepageToolList [data-tool-id]').length"), 6, "Homepage settings show every tool");
    assert.equal(await evaluate("[...document.querySelectorAll('#homepageToolList .settings-toggle')].filter(button => button.getAttribute('aria-checked') === 'true').length"), 6, "Homepage tools default visible");
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
    assert.equal(await evaluate("PackardSettings.getHomepagePreferences().name"), "Sam", "Reordering preserves the Homepage name");
    await evaluate("location.reload()");
    await loaded("/");
    assert.equal(await evaluate("document.getElementById('homeGreeting').textContent"), "Welcome, Sam.", "Homepage name survives refresh after reorder");
    await visit("/settings/");
    assert.equal(await evaluate("document.querySelector('#homepageToolList [data-tool-id=\\\"remarks\\\"] .homepage-move-button[data-homepage-move=\\\"up\\\"]').disabled"), false, "Homepage order persists after navigation");
    const reorderedMenuOrder = ["Home", "Med Tabs", "Canned Remarks", "Welcome Emails", "Fax Sender", "Intake Checker", "SSA Intake Assistant", "Settings"];
    for (const path of pages) {
      await visit(path);
      await evaluate("document.querySelector('.app-menu-toggle').click()");
      await until(() => evaluate("!!document.querySelector('.toolkit-navigation') && document.querySelector('.toolkit-navigation').getClientRects().length > 0"), "reordered menu open");
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.toolkit-navigation .toolkit-nav-item')].map(item => item.querySelector(':scope > span')?.textContent.trim() || item.textContent.trim())`), reorderedMenuOrder, `Saved order on ${path}`);
    }
    await visit("/settings/");
    for (const id of ["remarks", "med-tabs", "email", "fax", "intake", "ssa-intake"]) {
      await evaluate(`document.querySelector('#homepageToolList [data-tool-id=${JSON.stringify(id)}] .homepage-visibility-toggle').click()`);
      await visit("/");
      assert.equal(await evaluate(`(() => { const card = document.querySelector('[data-home-tool=${JSON.stringify(id)}]'); return card.hidden && getComputedStyle(card).display === 'none' && card.getClientRects().length === 0; })()`), true, `Homepage visibly hides ${id}`);
      await visit("/settings/");
      await evaluate(`document.querySelector('#homepageToolList [data-tool-id=${JSON.stringify(id)}] .homepage-visibility-toggle').click()`);
      await visit("/");
      assert.equal(await evaluate(`(() => { const card = document.querySelector('[data-home-tool=${JSON.stringify(id)}]'); return !card.hidden && card.getClientRects().length > 0; })()`), true, `Homepage shows ${id} again`);
      await visit("/settings/");
    }
    await evaluate("document.querySelector('#homepageToolList [data-tool-id=\\\"fax\\\"] .homepage-visibility-toggle').click()");
    await visit("/");
    await evaluate("location.reload()");
    await loaded("/");
    assert.equal(await evaluate("(() => { const card = document.querySelector('[data-home-tool=\\\"fax\\\"]'); return card.hidden && getComputedStyle(card).display === 'none' && card.getClientRects().length === 0; })()"), true, "Saved Homepage visibility removes the card from layout");
    for (const path of pages) {
      await visit(path);
      await evaluate("document.querySelector('.app-menu-toggle').click()");
      await until(() => evaluate("!!document.querySelector('.toolkit-navigation') && document.querySelector('.toolkit-navigation').getClientRects().length > 0"), "menu with hidden Homepage tool open");
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.toolkit-navigation .toolkit-nav-item')].map(item => item.querySelector(':scope > span')?.textContent.trim() || item.textContent.trim())`), reorderedMenuOrder, `Hidden Homepage tools remain in navigation on ${path}`);
    }
    await visit("/");
    await evaluate("(async () => { PackardSettings.saveHomepagePreferences({version:999, order:['fax'], hidden:['remarks']}); await PackardSettings.flushPreferences(); location.reload() })()");
    await loaded("/");
    assert.equal(await evaluate("document.querySelectorAll('.tool-card:not([hidden])').length"), 6, "Invalid homepage preferences fall back safely");
    await evaluate("(async () => { PackardSettings.saveHomepagePreferences({version:1, order:['remarks'], hidden:['unknown']}); await PackardSettings.flushPreferences(); location.reload() })()");
    await loaded("/");
    assert.equal(await evaluate("document.querySelectorAll('.tool-card:not([hidden])').length"), 6, "Missing and unknown homepage tools use defaults");
    assert.deepEqual(await evaluate("PackardSettings.getHomepagePreferences().order"), ["remarks", "med-tabs", "email", "fax", "intake", "ssa-intake"], "Older partial preferences append missing current tools");
    assert.deepEqual(await evaluate("PackardSettings.orderHomepageToolIds(['remarks', 'med-tabs', 'email', 'fax', 'intake', 'ssa-intake', 'future-tool'])"), ["remarks", "med-tabs", "email", "fax", "intake", "ssa-intake", "future-tool"], "Tools missing from a saved preference append safely");
    await visit("/settings/");
    await evaluate("document.getElementById('resetHomepage').click()");
    assert.equal(await evaluate("[...document.querySelectorAll('#homepageToolList .settings-toggle')].filter(button => button.getAttribute('aria-checked') === 'true').length"), 6, "Homepage reset restores visibility");
    await visit("/");
    assert.equal(await evaluate("document.querySelector('.tool-card:not([hidden]) strong').textContent"), "Canned Remarks", "Reset restores default Home order");
    for (const path of pages) {
      await visit(path);
      await evaluate("document.querySelector('.app-menu-toggle').click()");
      await until(() => evaluate("!!document.querySelector('.toolkit-navigation') && document.querySelector('.toolkit-navigation').getClientRects().length > 0"), "reset menu open");
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.toolkit-navigation .toolkit-nav-item')].map(item => item.querySelector(':scope > span')?.textContent.trim() || item.textContent.trim())`), defaultMenuOrder, `Reset order on ${path}`);
    }
    await visit("/settings/");
    await click('main a[href="../version-history/"]', "/version-history/");
    assert.equal(await evaluate("document.querySelectorAll('.version-history-section').length"), 7, "Independent history sections without a global Toolkit version");
    assert.equal(await evaluate("document.querySelectorAll('.version-history-section[open]').length"), 0, "History sections start collapsed");
    await evaluate("document.querySelector('[data-history-tool=\\\"home-page\\\"] > summary').click()");
    assert.equal(await evaluate("document.querySelectorAll('.version-history-section[open]').length"), 1, "History section expands");
    await evaluate("document.querySelector('[data-history-tool=\\\"fax-sender\\\"] > summary').click()");
    assert.equal(await evaluate("document.querySelectorAll('.version-history-section[open]').length"), 2, "Multiple history sections remain open");
    await evaluate("document.querySelector('[data-history-tool=\\\"home-page\\\"] > summary').click()");
    assert.equal(await evaluate("document.querySelectorAll('.version-history-section[open]').length"), 1, "History section collapses independently");
    assert.equal(await evaluate("document.querySelectorAll('.version-history-section article').length"), 55, "Checker-driven attention list");
    if (!process.argv.includes("--fax-only")) await checkIntake({ visit, click, evaluate, width, capture: async () => {
      const metrics = await cdp("Page.getLayoutMetrics");
      const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: metrics.cssContentSize.height, scale: 1 } });
      const path = join(profile, `intake-workspace-${width}.png`);
      await writeFile(path, Buffer.from(shot.data, "base64"));
      console.log(`Intake workspace screenshot: ${path}`);
    } });
    authenticated = false;
    await evaluate("localStorage.setItem('packard.faxHistory.v1','PRIVATE LEGACY CANARY')");
    await visit("/fax-sender/");
    await until(() => evaluate("document.getElementById('toolkitState')?.textContent === 'Signed out of the Toolkit.'"), "canonical Fax Sender authentication gate");
    assert(await evaluate("location.pathname === '/fax-sender/' && document.querySelector('h1').textContent === 'Fax Sender' && document.querySelector('[data-app-version=\"Fax Sender v3.3.1\"]')"), "Canonical Fax Sender v3.3.1 page");
    assert(await evaluate("document.getElementById('faxWorkspace').hidden && !document.getElementById('signIn').hidden && document.getElementById('connectForm').hidden"), "Signed-out users cannot access fax operations");
    assert(await evaluate("localStorage.getItem('packard.faxHistory.v1') === 'PRIVATE LEGACY CANARY' && ![...Object.keys(localStorage)].some(key => /fax-v3|ringcentral/i.test(key))"), "Canonical v3 preserves v2 localStorage history and creates no browser fax state");
    assert(await evaluate("!document.getElementById('sendFax') && !document.getElementById('faxHistoryList') && document.documentElement.scrollWidth <= innerWidth"), "Legacy v2 browser application is no longer canonical and v3 fits the viewport");
    const faxMetrics = await cdp("Page.getLayoutMetrics");
    const faxShot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: faxMetrics.cssContentSize.height, scale: 1 } });
    const faxPath = join(profile, `fax-v3-release-${width}.png`);
    await writeFile(faxPath, Buffer.from(faxShot.data, "base64"));
    console.log(`Fax v3.3.1 release screenshot: ${faxPath}`);
    console.log(`PASS (${width}px): Settings/history, footer links on all 8 pages, one canonical Fax Sender navigation entry, and no overflow.`);
  }
  authenticated = true;
  await visit("/settings/");
  await evaluate("PackardSettings.saveHomepagePreferences({...PackardSettings.getHomepagePreferences(), name: 'Sam'})");
  await visit("/");
  await until(() => evaluate("document.querySelector('.toolkit-auth-name')?.textContent === 'Authenticated Test User'"), "authenticated Toolkit session");
  assert.equal(await evaluate("document.getElementById('homeGreeting').textContent"), "Welcome, Sam.", "Authenticated Homepage usage keeps its saved personalized name");
  assert.equal(await evaluate("PackardSettings.getEmailSignatureText().startsWith('Email Name')"), true, "Homepage name remains separate from Email Sender signature");
  await visit("/welcome-email-sender/");
  await evaluate("document.querySelector('.app-menu-toggle').click()");
  await until(() => evaluate("!!document.querySelector('.toolkit-navigation') && document.querySelector('.toolkit-navigation').getClientRects().length > 0"), "authenticated Welcome Email menu open");
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.toolkit-navigation .toolkit-nav-item')].map(item => item.querySelector(':scope > span')?.textContent.trim() || item.textContent.trim())`), defaultMenuOrder, "Welcome Email's own navigation uses the saved default order");
  await visit("/");
  assert.equal(await evaluate("document.getElementById('homeGreeting').textContent"), "Welcome, Sam.", "Authenticated name survives page switching");
  const originalBrowserExit = once(child, "exit");
  await cdp("Browser.close").catch(() => {});
  await originalBrowserExit;
  socket.close();
  const reopenedBrowser = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--dump-dom", "--virtual-time-budget=3000", `${origin}/__homepage-reopen-check`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let reopenedDom = "";
  reopenedBrowser.stdout.setEncoding("utf8");
  reopenedBrowser.stdout.on("data", chunk => { reopenedDom += chunk; });
  const [reopenedExitCode] = await once(reopenedBrowser, "exit");
  assert.equal(reopenedExitCode, 0, "Browser reopens successfully using the same profile");
  assert.match(reopenedDom, /id="homeGreeting">Welcome, Sam\./, "Homepage name persists after closing and reopening the Toolkit");
  assert.match(reopenedDom, /Authenticated Test User/, "Authenticated session remains available to reopened Toolkit");
  console.log("PASS: authenticated Homepage name survives page changes and browser close/reopen in the same profile.");
  const cleanProfile = await mkdtemp(join(tmpdir(), "toolkit-account-new-device-"));
  const cleanBrowser = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${cleanProfile}`, "--dump-dom", "--virtual-time-budget=3000", `${origin}/__homepage-reopen-check`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let cleanDom = '';
  cleanBrowser.stdout.setEncoding('utf8');
  cleanBrowser.stdout.on('data', chunk => { cleanDom += chunk; });
  const [cleanExit] = await once(cleanBrowser, 'exit');
  assert.equal(cleanExit, 0);
  assert.match(cleanDom, /id="homeGreeting">Welcome, Sam\./, 'A clean browser profile restores the account Homepage name without local preferences');
  console.log('PASS: a clean browser profile restores the same account preferences.');
  assert.deepEqual(failures, [], "No missing resources, unexpected API calls, console or runtime errors");
  console.log("PASS: no broken resources, console/runtime errors, or API calls.");
} finally {
  socket?.close();
  child.kill();
  server.closeAllConnections();
  server.close();
}
