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
test("Email Sender mode isolation, confirmation, progress, locking and retry", { skip: !browserPath, timeout: 60000 }, async t => {
  const server = await createServer({
    configFile: false,
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "mock-outlook-for-test", enforce: "pre", load(id) {
      if (!id.replaceAll("\\", "/").endsWith("/welcome-email-sender/outlookGraph.js")) return;
      return `
        window.mailTest = { drafts: [], sends: [], preparations: 0, fail: true };
        export const getOutlookErrorMessage = () => "Test draft kept in this page";
        export async function createOutlookDraft(content) {
          window.mailTest.drafts.push(content);
          throw new Error("Prevent navigation in test");
        }
        export async function prepareOutlookBulkSend(content) {
          window.mailTest.preparations++;
          return async recipient => {
            window.mailTest.sends.push({ ...content, recipient });
            await new Promise(resolve => setTimeout(resolve, 200));
            if (window.mailTest.fail && recipient === "fail@example.com") throw new Error("Simulated failure");
          };
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
  assert.equal(await evaluate("document.querySelector('button[type=submit]').disabled"), true);
  await input("#bulk-recipients", "a@example.com; A@EXAMPLE.COM\nfail@example.com\tbad");
  assert.equal(await evaluate("document.querySelector('button[type=submit]').textContent.trim()"), "Send 2 Emails");
  assert.match(await evaluate("document.querySelector('#bulk-recipient-summary').textContent"), /2 unique valid.*1 duplicates removed.*1 invalid/);
  await click("Single");
  assert.equal(await evaluate("document.querySelector('#client-email').value"), "single@example.com");
  await click("Open Outlook Draft");
  await waitFor("window.mailTest.drafts.length === 1");
  assert.equal(await evaluate("window.mailTest.drafts[0].recipient"), "single@example.com");
  assert.equal(await evaluate("window.mailTest.sends.length"), 0);
  await input("#case-manager", "Amanda Zuscar");
  await click("Bulk");
  await click("Send 2 Emails");
  await waitFor("document.querySelector('dialog').open");
  assert.equal(await evaluate("window.mailTest.sends.length"), 0);
  await click("Cancel");
  assert.equal(await evaluate("document.querySelector('dialog').open"), false);
  await click("Send 2 Emails");
  await evaluate("document.querySelector('dialog .primary-button').click()");
  await waitFor("window.mailTest.sends.length === 1");
  assert.equal(await evaluate("document.querySelector('#bulk-recipients').matches(':disabled') && document.querySelector('#case-manager').matches(':disabled') && document.querySelector('.language-option').disabled"), true);
  assert.match(await evaluate("document.querySelector('.bulk-results').textContent"), /Sending 1 of 2/);
  await waitFor("document.querySelector('.bulk-results').textContent.includes('1 sent · 1 failed')");
  await input("#case-manager", "Becky Smith");
  await input("#bulk-recipients", "new@example.com");
  await evaluate("window.mailTest.fail = false");
  await click("Retry Failed");
  await evaluate("document.querySelector('dialog .primary-button').click()");
  await waitFor("document.querySelector('.bulk-results').textContent.includes('2 sent')");
  const sends = await evaluate("window.mailTest.sends");
  assert.deepEqual(sends.map(message => message.recipient), ["a@example.com", "fail@example.com", "fail@example.com"]);
  assert.ok(sends.every(message => message.managerName === "Amanda Zuscar" && message.body === sends[0].body && message.subject === sends[0].subject));
  assert.equal(await evaluate("window.mailTest.preparations"), 1);
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  await command("Browser.close");
});
