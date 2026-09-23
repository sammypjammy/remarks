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

// Exercise the actual Canned Remarks UI at desktop and mobile widths.
test("Canned Remarks v2.9.0 desktop and mobile workflows", { skip: !browserPath, timeout: 60000 }, async t => {
  const server = await createServer({configFile:false, server:{host:"127.0.0.1",port:0},
    plugins: [{ name: 'mock-toolkit-session', configureServer(server) {
      server.middlewares.use('/api/auth/session', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ authenticated: false }));
      });
    } }] });
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
    for(let i=0;i<100;i++){if(await evaluate(expression)) return; await pause(50);}
    assert.fail(expression);
  };
  for (const width of [1280,390]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await command('Page.navigate',{url:origin+'/canned-remarks/'});
    await waitFor("document.querySelector('[data-application=ssi]') && document.querySelector('.remark-card')");
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const fill = (selector,value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('[data-application=ssi]');
    await click('[name=ssi-marriage-status][value=yes]');
    assert.equal(await evaluate("document.getElementById('ssiPreviewText').textContent"),'The claimant is currently married.');
    await click('#ssi-separated');
    assert.match(await evaluate("document.getElementById('ssiPreviewText').textContent"),/married but separated and does not share assets with their spouse/);
    await click('#ssi-separated');
    assert.equal(await evaluate("document.getElementById('ssiPreviewText').textContent"),'The claimant is currently married.');
    await click('#ssi-separated');
    await click('[name=ssi-marriage-status][value=no]');
    assert.equal(await evaluate("!!document.getElementById('ssi-separated')"),false);
    await click('[name=ssi-marriage-status][value=yes]');
    assert.equal(await evaluate("document.getElementById('ssi-separated').checked"),false);
    await click('[name=ssi-part-time-work][value=yes]');
    await fill('#ssiDetailInput','$1,234.50');
    await evaluate("document.querySelector('#modalContent form').requestSubmit()");
    assert.match(await evaluate("document.getElementById('ssiPreviewText').textContent"),/The claimant works part time earning approximately \$1,234.50 per month\./);
    for(const application of ['filing','795']) {
      await click('[data-application="'+application+'"]');
      await evaluate("[...document.querySelectorAll('.remark-card')].find(el=>el.textContent.includes('Disabled Veteran')).click()");
      assert.equal(await evaluate("!!document.getElementById('field-conditions')"),false);
      assert.equal(await evaluate("document.getElementById('field-vaAmount').disabled"),true);
      await fill('#field-vaBenefits','yes');
      assert.equal(await evaluate("document.getElementById('field-vaAmount').required"),true);
      await fill('#field-vaAmount','$2,000');
      assert.match(await evaluate("document.getElementById('remarkPreview').textContent"),/receives \$2,000 per month in VA benefits/);
      assert.equal(await evaluate("document.getElementById('remarkPreview').textContent.includes('We have sent in a 795')"),application==='filing');
      await fill('#field-vaBenefits','no');
      assert.equal(await evaluate("document.getElementById('field-vaAmount').disabled"),true);
      assert.match(await evaluate("document.getElementById('remarkPreview').textContent"),/does not receive VA benefits/);
      assert.equal(await evaluate("document.getElementById('remarkPreview').textContent.includes('2,000')"),false);
      await click('#closeModalButton');
    }
    await click('[data-application=filing]');
    await evaluate("[...document.querySelectorAll('.remark-card')].find(el=>el.textContent.includes('Money Received after Onset')).click()");
    await fill('#field-source','Part-time Income');
    await fill('#field-amount','$1,234.50');
    assert.equal(await evaluate("document.getElementById('remarkPreview').textContent"),'PreviewThe claimant works part time earning approximately $1,234.50 per month.');
    await fill('#field-source','Early Retirement Benefits');
    assert.match(await evaluate("document.getElementById('remarkPreview').textContent"),/received Early Retirement Benefits after the onset/);
    await click('#closeModalButton');
    assert.match(await evaluate("document.querySelector('.app-footer').textContent"),/Canned Remarks v2.9.0/);
    await click('a[href="#canned-version-history"]');
    assert.equal(await evaluate("document.getElementById('canned-version-history').open"),true);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"),true);
  }
});
