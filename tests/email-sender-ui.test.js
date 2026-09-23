import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { createServer } from "vite";

const browserPath = process.env.CHROME_BIN || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);

// Real browser and React state, with only the Outlook boundary replaced.
// No authentication or real email is performed by this test.
test("Email Sender manual draft tabs, Single isolation, popup feedback and footer version", { skip: !browserPath, timeout: 60000 }, async t => {
  const server = await createServer({
    configFile: false,
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: 'mock-toolkit-session', configureServer(server) {
      server.middlewares.use('/api/auth/session', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ authenticated: false }));
      });
    } }, { name: "mock-outlook-for-test", enforce: "pre", load(id) {
      if (!id.replaceAll("\\", "/").endsWith("/welcome-email-sender/outlookGraph.js")) return;
      return `
        window.mailTest = { drafts: [], tabs: [], preparations: 0, blocked: false };
        window.open = () => {
          if (window.mailTest.blocked) return null;
          const tab = { location: { href: 'about:blank' }, closed:false, close(){this.closed=true;} };
          window.mailTest.tabs.push(tab); return tab;
        };
        export const getOutlookErrorMessage = () => "Test draft kept in this page";
        export async function getGraphAccessToken() {
          window.mailTest.preparations++;
          if(window.mailTest.tabs.length !== 2) throw Error('Tabs must open before sign-in');
          return 'mock';
        }
        export async function createOutlookDraft(content) {
          window.mailTest.drafts.push(content);
          if (content.recipient === 'single@example.com') throw new Error("Prevent single navigation in test");
          await new Promise(resolve=>setTimeout(resolve,200));
          return { id: content.recipient, webLink: 'https://outlook.office.com/mail/drafts/' + encodeURIComponent(content.recipient) };
        }
      `;
    } }],
  });
  await server.listen();
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), "packard-email-test-"));
  const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let socket;
  t.after(async () => {
    socket?.close();
    browser.kill();
    await pause(500);
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()), "only remove this test's temporary browser profile");
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    port = await readFile(join(profile, "DevToolsActivePort"), "utf8").then(text => text.split("\n")[0]).catch(() => null);
    if (!port) await pause(100);
  }
  assert.ok(port, "headless browser started");
  const page = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(50); }
    assert.fail(`Timed out: ${expression}`);
  };
  const click = async text => {
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
    await pause(30);
  };
  const input = async (selector, value) => {
    await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    })()`);
    await pause(30);
  };
  await command("Page.navigate", { url: `${origin}/welcome-email-sender/` });
  await waitFor("Boolean(document.querySelector('#client-email'))");
  await evaluate("window.PackardSettings.saveEmailSignature('Test User\\nCase Manager\\n555-0100'); window.PackardSettings.setSetting('openDraftsInNewTab', false); window.dispatchEvent(new Event('packardsettingschange'))");
  await input("#client-email", "single@example.com");
  await input("#case-manager", "Amanda Zuscar");
  await click("Bulk");
  assert.equal(await evaluate("document.querySelector('button[type=submit]').disabled"),true);
  await input("#bulk-recipients","a@example.com; A@EXAMPLE.COM\nb@example.com\tbad");
  assert.equal(await evaluate("document.querySelector('button[type=submit]').textContent.trim()"),"Open 2 Drafts");
  assert.match(await evaluate("document.querySelector('#bulk-recipient-summary').textContent"),/2 unique valid.*1 duplicates removed.*1 invalid/);
  await click("Single");
  assert.equal(await evaluate("document.querySelector('#client-email').value"),"single@example.com");
  await click("Open Outlook Draft");await waitFor("window.mailTest.drafts.length === 1");
  assert.equal(await evaluate("window.mailTest.tabs.length"),0);
  await input("#case-manager","Amanda Zuscar");await click("Bulk");
  await evaluate("window.mailTest.blocked=true");await click("Open 2 Drafts");
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('Allow pop-ups and redirects')");
  assert.equal(await evaluate("window.mailTest.drafts.length"),1);
  assert.equal(await evaluate("window.mailTest.preparations"),0);
  await evaluate("window.mailTest.blocked=false");await click("Open 2 Drafts");
  await waitFor("window.mailTest.drafts.length === 3");
  assert.equal(await evaluate("document.querySelector('#bulk-recipients').matches(':disabled')"),true);
  await waitFor("window.mailTest.tabs.every(tab=>tab.location.href !== 'about:blank')");
  const drafts=await evaluate("window.mailTest.drafts.slice(1)");
  assert.deepEqual(drafts.map(d=>d.recipient),['a@example.com','b@example.com']);
  assert.ok(drafts.every(d=>d.subject===drafts[0].subject&&d.body===drafts[0].body&&d.managerName==='Amanda Zuscar'));
  assert.equal(await evaluate("window.mailTest.tabs.length"),2);
  assert.equal(await evaluate("document.querySelectorAll('dialog,.bulk-results,.bulk-confirmation').length"),0);
  assert.equal(await evaluate("document.body.textContent.includes('Retry Failed')"),false);
  await input('#bulk-recipients','one@example.com');
  assert.equal(await evaluate("document.querySelector('button[type=submit]').textContent.trim()"),'Open 1 Draft');
  assert.match(await evaluate("document.querySelector('.app-footer').textContent"),/Email Sender v2.6.0/);
  await evaluate("document.querySelector('.app-footer-links a[href=\"#email-version-history\"]').click()");
  assert.equal(await evaluate("document.querySelector('#email-version-history').open"),true);
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),true);
  await command("Browser.close");
});
