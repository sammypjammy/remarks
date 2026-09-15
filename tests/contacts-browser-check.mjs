// Real browser integration with local mocks. No RingCentral requests or real fax sends.
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const browser = process.argv[2];
if (!browser) throw new Error("Provide a Chromium browser executable path.");
const directory = await mkdtemp(join(tmpdir(), "fax-contacts-browser-"));
let html = await readFile(new URL("../fax-sender/index.html", import.meta.url), "utf8");
html = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<link[^>]+>/g, "");
const sources = await Promise.all(["tracking.js", "batch.js", "contacts.js", "main.js"].map(async file =>
  (await readFile(new URL(`../fax-sender/${file}`, import.meta.url), "utf8")).replace(/^\uFEFF/, "").replace(/^import .*;\r?\n/gm, "")));
const script = `
const fixtures = [
  { id: "1", name: "Albuquerque SSA", company: "Social Security", location: "Albuquerque, NM", faxNumbers: [{ label: "Business fax", number: "+18665551234" }, { label: "Other fax", number: "+18335555678" }] },
  { id: "2", name: "No Fax SSA", company: "", location: "", faxNumbers: [] }
];
let contactCalls = 0, failContacts = false;
globalThis.fetch = async url => {
  if (url !== "/api/ringcentral-contacts") throw new Error("Unexpected network request blocked: " + url);
  contactCalls++;
  return failContacts ? Response.json({ success: false }, { status: 403 }) : Response.json({ success: true, contacts: fixtures });
};
${sources.join("\n")}
const check = (value, message) => { if (!value) throw new Error(message); };
try {
  const submissions = [];
  batch.submit = async (file, number) => { submissions.push(number); return { messageId: String(submissions.length), status: "Sent" }; };
  await contactPicker.load();
  contactPicker.search.value = "Albu";
  contactPicker.search.dispatchEvent(new Event("input"));
  check(contactCalls === 1, "Search must reuse cached contacts");
  const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
  contactPicker.search.dispatchEvent(enter);
  check(enter.defaultPrevented, "Enter in contact search must not submit the fax form");
  const choices = document.querySelectorAll("#contactResults button");
  check(choices.length === 2, "Both fax numbers must be selectable");
  choices[1].click();
  check(numberInput.value === "+18335555678", "Other fax must populate existing destination");
  numberInput.value = "+18015550000";
  numberInput.dispatchEvent(new Event("input"));
  await batch.addFiles([new File(["%PDF-1.4"], "test.pdf", { type: "application/pdf" })]);
  check(!button.disabled, "Manual entry must remain usable");
  await batch.run(numberInput.value);
  check(submissions[0] === "+18015550000", "Manual override must be the only destination");
  check(contactPicker.search.disabled && numberInput.disabled, "Destination must lock");
  contactPicker.select(fixtures[0], fixtures[0].faxNumbers[0]);
  check(numberInput.value === "+18015550000", "Locked destination cannot change");
  clearButton.click();
  check(!contactPicker.search.disabled && !numberInput.disabled, "Clear All must unlock");
  contactPicker.select(fixtures[0], fixtures[0].faxNumbers[0]);
  check(numberInput.value === "+18665551234", "New destination after Clear All");
  contactPicker.search.value = "no fax"; contactPicker.render();
  check(document.querySelectorAll("#contactResults button").length === 0, "Contact without fax cannot be selected");
  failContacts = true;
  await contactPicker.load(true);
  check(contactPicker.message.textContent.includes("Enter a fax number manually"), "Failure must explain manual fallback");
  numberInput.value = "+18015551111"; numberInput.dispatchEvent(new Event("input"));
  await batch.addFiles([new File(["%PDF-1.4"], "manual.pdf", { type: "application/pdf" })]);
  check(!button.disabled, "Loading failure must not disable manual faxing");
  await batch.run(numberInput.value);
  check(submissions[1] === "+18015551111", "Manual faxing must still run after contact failure");
  document.getElementById("browserResult").textContent = "PASS: contact selection, local search, multiple faxes, manual override, destination lock, Clear All, no-fax contacts, and loading-failure fallback";
} catch (error) { document.getElementById("browserResult").textContent = "FAIL: " + error.stack; }
`;
html = html.replace("</body>", `<pre id="browserResult">RUNNING</pre><script type="module">${script}</script></body>`);
const path = join(directory, "check.html");
await writeFile(path, html);
const { stdout } = await promisify(execFile)(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${join(directory, "profile")}`, "--dump-dom", "--virtual-time-budget=5000", pathToFileURL(path).href
], { timeout: 60_000, maxBuffer: 2_000_000, windowsHide: true });
const result = stdout.match(/<pre id="browserResult">([\s\S]*?)<\/pre>/)?.[1] || "FAIL: no browser result";
console.log(result);
if (!result.startsWith("PASS:")) process.exitCode = 1;
