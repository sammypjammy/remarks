// Real Chromium regression check: no RingCentral calls or fax submissions.
// Run: node tests/tracking-browser-check.mjs "C:\path\to\chrome.exe"
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const browser = process.argv[2];
if (!browser) throw new Error("Provide a Chromium browser executable path.");
const directory = await mkdtemp(join(tmpdir(), "fax-tracking-browser-"));
const source = await readFile(new URL("../fax-sender/tracking.js", import.meta.url), "utf8");
const html = `<!doctype html><body><pre id="result">RUNNING</pre><script type="module">
${source}
const output = document.getElementById("result");
const nativeFetch = globalThis.fetch;
const calls = [];
// Exercise native fetch and response.json against a local data URL, never the network.
globalThis.fetch = (url, options) => {
  calls.push(url);
  return nativeFetch.call(globalThis, "data:application/json," + encodeURIComponent(JSON.stringify({
    success: true, messageId: "123", status: calls.length === 1 ? "Queued" : "Sent", terminal: calls.length > 1
  })), options);
};
try {
  const cancelled = new FaxTracker();
  cancelled.start({ id: 2, messageId: "456", status: "Queued" });
  cancelled.clear();
  if (cancelled.timer !== null || cancelled.pending.size) throw new Error("Timer cancellation failed");
  const doc = { id: 1, messageId: "123", status: "Queued" };
  const tracker = new FaxTracker({ onChange: () => {
    if (doc.state === "Delivered") {
      if (calls.length !== 2 || calls.some(url => url !== "/api/fax-status?messageId=123")) {
        output.textContent = "FAIL: unexpected status request sequence";
      } else output.textContent = "PASS: native timers, cancellation, lookupFax, Queued -> Sent; two status GETs; no fax POSTs";
    }
  } });
  tracker.start(doc);
} catch (error) {
  output.textContent = "FAIL: " + error.stack;
}
</script>`;
const path = join(directory, "check.html");
await writeFile(path, html);
const { stdout } = await promisify(execFile)(browser, [
  "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${join(directory, "profile")}`, "--dump-dom", "--virtual-time-budget=50000",
  pathToFileURL(path).href
], { timeout: 60_000, maxBuffer: 2_000_000, windowsHide: true });
const result = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] || "FAIL: no browser result";
console.log(result);
if (!result.startsWith("PASS:")) process.exitCode = 1;
