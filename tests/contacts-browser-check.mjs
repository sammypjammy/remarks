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
const styles = await Promise.all(["../settings/shared/style.css", "../fax-sender/styles.css"].map(file => readFile(new URL(file, import.meta.url), "utf8")));
html = html.replace("</head>", `<style>${styles.join("\n")}</style></head>`);
const sources = await Promise.all(["tracking.js", "message.js", "receipts-zip.js", "history.js", "batch.js", "contacts.js", "main.js"].map(async file =>
  (await readFile(new URL(`../fax-sender/${file}`, import.meta.url), "utf8")).replace(/^\uFEFF/, "").replace(/^import .*;\r?\n/gm, "")));
const zipLibrary = await readFile(new URL("../node_modules/fflate/umd/index.js", import.meta.url), "utf8");
const script = `
const { zipSync } = fflate;
// Keep mocked PDF reads on the microtask queue so headless virtual time is deterministic.
const mockPdf = name => ({ name, size: 8, type: "application/pdf", lastModified: 1, slice: () => ({ text: async () => "%PDF-" }) });
const fixtures = [
  { id: "1", name: "Albuquerque SSA", company: "Social Security", location: "Albuquerque, NM", faxNumbers: [{ label: "Business fax", number: "+18665551234" }, { label: "Other fax", number: "+18335555678" }] },
  { id: "2", name: "No Fax SSA", company: "", location: "", faxNumbers: [] },
  { id: "3", name: "San Antonio Downtown LO", company: "Social Security", location: "San Antonio, TX", faxNumbers: [{ label: "Business fax", number: "+18339502396" }] }
];
let contactCalls = 0, failContacts = false, releaseContacts = null, holdContacts = false;
globalThis.fetch = async url => {
  if (url !== "/api/ringcentral-contacts") throw new Error("Unexpected network request blocked: " + url);
  contactCalls++;
  if (holdContacts) await new Promise(resolve => { releaseContacts = resolve; });
  return failContacts ? Response.json({ success: false }, { status: 403 }) : Response.json({ success: true, contacts: fixtures });
};
${sources.join("\n")}
const check = (value, message) => { if (!value) throw new Error(message); };
const query = value => {
  contactPicker.search.value = value;
  contactPicker.search.dispatchEvent(new Event("input"));
};
const dropdown = document.getElementById("contactDropdown");
const clearDestination = document.getElementById("clearDestination");
try {
  const historyPanel = document.getElementById("faxHistory");
  check(historyPanel.open === (innerWidth >= 1100), "History must open on desktop and collapse on mobile");
  check(!document.getElementById("faxHistoryEmpty").hidden, "Empty history must explain where attempts appear");
  if (!historyPanel.open) historyPanel.querySelector("summary").click();
  const refreshRect = document.getElementById("reloadContacts").getBoundingClientRect();
  const iconRect = document.querySelector("#reloadContacts svg").getBoundingClientRect();
  check(Math.abs((refreshRect.left + refreshRect.right - iconRect.left - iconRect.right) / 2) < 1, "Refresh icon must be horizontally centered");
  check(Math.abs((refreshRect.top + refreshRect.bottom - iconRect.top - iconRect.bottom) / 2) < 1 && iconRect.width === 20, "Refresh icon must be centered and 20px");
  const panelRect = document.querySelector(".fax-panel").getBoundingClientRect();
  const historyRect = historyPanel.getBoundingClientRect();
  check(innerWidth >= 1100 ? historyRect.left >= panelRect.right && panelRect.width > historyRect.width : historyRect.top >= panelRect.bottom, "History must be secondary on right or below workflow");
  const submissions = [];
  batch.submit = async (file, number) => { submissions.push(number); return { messageId: String(submissions.length), status: "Sent" }; };
  await contactPicker.load();
  const pdfTop = fileInput.getBoundingClientRect().top;
  query("Albu");
  check(contactCalls === 1, "Search must reuse cached contacts");
  check(!dropdown.hidden, "Search must open dropdown");
  check(getComputedStyle(dropdown).position === "absolute", "Dropdown must overlay content");
  check(fileInput.getBoundingClientRect().top === pdfTop, "Dropdown must not push PDF layout");
  check(dropdown.getBoundingClientRect().right <= innerWidth, "Dropdown must fit viewport");
  const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
  contactPicker.search.dispatchEvent(enter);
  check(enter.defaultPrevented, "Enter in search must not submit fax form");
  const choices = document.querySelectorAll("#contactResults button");
  check(choices.length === 2, "Both fax numbers must be selectable");
  check(document.querySelectorAll(".destination-group-name").length === 1, "Multiple faxes must share one contact heading");
  choices[1].click();
  check(numberInput.value === "+18335555678", "Other fax must populate existing destination");
  check(dropdown.hidden, "Selection must close dropdown");
  check(contactPicker.search.value === "Albuquerque SSA • (833) 555-5678", "Selected state must display name and formatted fax");
  check(numberInput.type === "hidden", "No second visible fax input");
  clearDestination.click();
  check(!numberInput.value && !contactPicker.search.value, "X must clear unlocked destination");
  query("San Antonio");
  check(document.querySelectorAll("#contactResults button").length === 1, "One fax must have one whole-row button");
  document.querySelector("#contactResults button").click();
  check(numberInput.value === "+18339502396", "Whole-row selection must preserve E.164");
  check(contactPicker.search.value.includes("Downtown LO"), "Actual LO contact name must be preserved");
  clearDestination.click();
  query("Albu");
  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  check(dropdown.hidden, "Outside click must close dropdown");
  query("Albu");
  contactPicker.search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check(dropdown.hidden, "Escape must close dropdown");
  query("Albu");
  contactPicker.search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  check(document.activeElement === document.querySelector("#contactResults button"), "ArrowDown must focus a choice");
  contactPicker.search.focus();
  query("8015550000");
  check(document.querySelector("#contactResults button").textContent.includes("(801) 555-0000"), "Manual number must appear formatted");
  document.querySelector("#contactResults button").click();
  check(numberInput.value === "+18015550000", "Manual selection must set normalized destination");
  await batch.addFiles([mockPdf("test.pdf")]);
  check(document.getElementById("documentCount").textContent === "Documents", "Documents heading must not include a count");
  check(!document.querySelector("#documentList .fax-state"), "Pre-send cards must not show Ready");
  check(result.hidden && !result.textContent, "Pre-send batch counters must be absent");
  check(!document.getElementById("batchReview"), "Redundant destination/readiness sentence must be removed");
  check(button.textContent === "Send Fax", "Single-document button must say Send Fax");
  check(!button.disabled, "Manual entry must enable sending");
  batch.lastFourSsn = "2134"; await batch.run(numberInput.value);
  check(document.querySelectorAll("#faxHistoryList li").length === 1 && document.getElementById("faxHistoryEmpty").hidden, "Sending must populate history");
  check(document.getElementById("faxHistoryList").textContent.includes("Sent ✓") && document.getElementById("faxHistoryList").textContent.includes("+18015550000"), "History must show sent status and destination");
  check(submissions[0] === "+18015550000", "Manual number must be sole destination");
  check(result.textContent === "✓ Fax sent successfully", "One successful fax must use singular completion summary");
  check(document.querySelector("#documentList .fax-state").textContent === "Sent ✓", "Post-send card status must remain");
  check(contactPicker.search.disabled && numberInput.disabled && clearDestination.disabled, "Destination and X must lock");
  contactPicker.select(fixtures[0], fixtures[0].faxNumbers[0]);
  contactPicker.select(null, { number: "+18015559999" });
  contactPicker.clear();
  check(numberInput.value === "+18015550000", "Contact, manual, and clear actions cannot bypass lock");
  clearButton.click();
  check(!contactPicker.search.disabled && !numberInput.value, "Clear All must unlock and reset destination");
  query("San Antonio"); document.querySelector("#contactResults button").click();
  check(numberInput.value === "+18339502396", "New destination after Clear All");
  clearDestination.click();
  query("no fax");
  check(document.querySelectorAll("#contactResults button").length === 0, "No-fax contact cannot be selected");
  const beforeRefresh = contactCalls;
  holdContacts = true;
  contactPicker.reload.click();
  check(contactPicker.loading && contactPicker.reload.disabled, "Refresh must indicate loading and disable repeated clicks");
  contactPicker.reload.click(); await contactPicker.load(true);
  check(contactCalls === beforeRefresh + 1, "Refresh cannot be spammed");
  releaseContacts(); holdContacts = false;
  for (let attempt = 0; contactPicker.loading && attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  check(!contactPicker.loading, "Refresh must finish");
  failContacts = true;
  await contactPicker.load(true);
  check(contactPicker.message.textContent.includes("You can still enter a fax number"), "Failure must explain fallback");
  query("8015551111");
  document.querySelector("#contactResults button").click();
  await batch.addFiles([mockPdf("manual.pdf")]);
  check(!button.disabled, "Contact failure must not disable manual faxing");
  batch.lastFourSsn = "2134"; await batch.run(numberInput.value);
  check(submissions[1] === "+18015551111", "Manual faxing must work after contact failure");
  check(document.querySelectorAll("#faxHistoryList li").length === 2, "History must retain prior cleared batch");
  check(document.querySelector("#faxHistoryList li").textContent.includes("manual.pdf"), "Newest fax must appear first");
  // Exercise the form -> batch -> tracker -> history path with a named recipient.
  clearButton.click();
  contactPicker.select(fixtures[0], fixtures[0].faxNumbers[0]);
  await batch.addFiles([mockPdf("tracked.pdf")]);
  let trackingClock = 0;
  batch.tracker.now = () => trackingClock;
  batch.tracker.schedule = () => 1;
  batch.tracker.cancel = () => {};
  batch.tracker.lookup = async messageId => ({ messageId, status: "Sent" });
  batch.submit = async () => ({ messageId: "3", status: "Queued" });
  batch.lastFourSsn = "2134";
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  for (let i = 0; batch.running && i < 20; i++) await Promise.resolve();
  check(document.querySelector("#faxHistoryList li").textContent.includes("Albuquerque SSA"), "Form submission must retain recipient name");
  check(document.querySelector("#faxHistoryList li").textContent.includes("Submitted"), "Queued history must not imply Sent");
  trackingClock = 10000;
  await batch.tracker.tick();
  check(document.querySelector("#faxHistoryList li").textContent.includes("Sent ✓"), "Tracking must update history to Sent");
  // Presentation-only fixtures: preserve the existing sending/tracking tests above.
  clearButton.click();
  await batch.addFiles(["one.pdf", "two.pdf", "three.pdf"].map(name => mockPdf(name)));
  check(button.textContent === "Send 3 Faxes", "Multiple-document send label must include the count");
  check(result.hidden, "New batch must reset the summary");
  batch.documents.forEach((doc, index) => {
    doc.attemptedAt = new Date().toISOString(); doc.sequence = batch.nextAttempt++;
    doc.faxNumber = "+18015551234"; doc.recipientName = "Example recipient";
    doc.attempts = 1; doc.messageId = String(100 + index); doc.state = "Delivered"; doc.status = "Sent";
  });
  batch.documents[1].state = "Queued"; batch.documents[1].status = "Queued"; batch.documents[1].tracking = true;
  batch.documents[2].state = "Submitting";
  batch.running = true; batch.progress = { current: 2, total: 3 };
  render();
  check(result.textContent === "Sending 2 of 3...", "Active progress must be one simple message");
  check([...document.querySelectorAll("#documentList .fax-state")].map(node => node.textContent).join("|") === "Sent ✓|Submitted|Processing...", "Active card statuses must remain meaningful");
  batch.running = false; batch.progress = null; batch.documents[2].state = "Queued";
  render();
  check(result.textContent === "Checking fax status...", "Tracking must use a single message");
  batch.documents.forEach(doc => { doc.state = "Delivered"; doc.status = "Sent"; doc.tracking = false; });
  render();
  check(result.textContent === "✓ 3 faxes sent successfully", "All-success summary must be concise");
  check(document.querySelector(".fax-panel").textContent.split("✓ 3 faxes sent successfully").length === 2, "Completion summary must appear only once");
  batch.documents[2].state = "Failed"; batch.documents[2].status = "SendingFailed";
  batch.documents[2].retryable = true; batch.documents[2].error = "Safe failure detail";
  render();
  check(result.textContent === "2 sent · 1 failed", "Mixed summary must omit zero counters");
  check(!retryButton.hidden && document.querySelector('[aria-label="Retry three.pdf"]'), "Failure retry controls must remain");
  check(document.getElementById("documentList").textContent.includes("Message ID: 102") && document.getElementById("documentList").textContent.includes("SendingFailed") && document.getElementById("documentList").textContent.includes("Safe failure detail"), "Post-send diagnostics must remain");
  batch.documents[2].state = "Status Unknown"; batch.documents[2].retryable = false;
  batch.documents[2].status = "Queued";
  render();
  check(result.textContent === "2 sent · 1 status unknown", "Unknown must not count as failed");
  check(retryButton.hidden && !document.querySelector('[aria-label="Retry three.pdf"]'), "Unknown must not enable Retry");
  const info = document.getElementById("faxSendingInfo");
  check(!info.open, "Sending info must be collapsed initially");
  info.querySelector("summary").click();
  check(info.open && info.textContent.includes("15 minutes") && info.textContent.includes("duplicate protection"), "Info must expand with original safety explanations");
  info.querySelector("summary").click();
  check(!info.open, "Info must collapse again");
  check(!document.getElementById("version-history"), "Fax page must not contain an inline version history");
  clearButton.click();
  contactPicker.contacts = fixtures;
  contactPicker.select(null, { number: "+18335551234" });
  check(!document.getElementById("offerSaveContact").hidden, "Unsaved manual number must offer contact creation");
  document.getElementById("offerSaveContact").click();
  document.getElementById("contactName").value = "New SSA Office";
  let createCalls = 0, releaseCreate;
  globalThis.fetch = async (url, options) => {
    check(url === "/api/ringcentral-contacts" && options.method === "POST", "Creation must use the server endpoint");
    createCalls++;
    await new Promise(resolve => { releaseCreate = resolve; });
    return Response.json({ success: true, contact: { id: "77", name: "New SSA Office", faxNumbers: [{ label: "Business fax", number: "+18335551234" }] } });
  };
  const saving = contactPicker.saveContact();
  await contactPicker.saveContact();
  check(createCalls === 1 && document.getElementById("saveContact").disabled, "Repeated save must not create twice");
  releaseCreate(); await saving;
  check(contactPicker.selectedName === "New SSA Office" && document.getElementById("offerSaveContact").hidden, "Saved contact must immediately populate selection and suppress duplicate action");
  await batch.addFiles(["827.pdf", "DIB DR.pdf", "SSA-3368.pdf", "Pending.pdf"].map(name => mockPdf(name)));
  batch.lastFourSsn = "2134";
  batch.documents.forEach((doc, index) => {
    doc.state = "Delivered"; doc.messageId = String(200 + index);
    if (index < 3) doc.transmissionDetails = { attachments: [{ type: "RenderedDocument", downloadUrl: "/api/fax-attachment?messageId=" + doc.messageId + "&attachmentId=" + doc.messageId }] };
  });
  render();
  check(document.getElementById("receiptAvailability").textContent.includes("3 of 4"), "Partial readiness must be explicit");
  let downloads = [], fetched = [], failReceipt = true;
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  globalThis.fetch = async url => {
    check(url.startsWith("/api/fax-attachment?"), "Bulk download must never send faxes or refetch message details");
    fetched.push(url);
    const blob = new Blob(["%PDF-receipt"]);
    blob.arrayBuffer = async () => new TextEncoder().encode("%PDF-receipt").buffer;
    return { ok: !(failReceipt && url.includes("messageId=201")), blob: async () => blob };
  };
  await downloadReceipts();
  check(downloads.join("|") === "Fax Receipt - 827 2134.pdf|Fax Receipt - SSA-3368 2134.pdf", "Separate downloads must retain per-document filenames");
  check(document.getElementById("receiptDownloadStatus").textContent.includes("DIB DR.pdf"), "Failed receipt must identify its document");
  check(batch.documents.every(doc => doc.state === "Delivered"), "Receipt failure must preserve Sent status");
  failReceipt = false;
  await downloadReceipts(true);
  check(downloads.at(-1) === "Fax Receipts.zip", "Fallback must request one ZIP download");
  check(fetched.length === 4, "ZIP fallback must reuse successful in-memory receipt fetches");
  check(document.querySelectorAll('#documentList button[aria-label^="Download Fax Receipt"]').length === 3, "Individual prominent receipt buttons must remain");
  HTMLAnchorElement.prototype.click = nativeClick;
  check(document.documentElement.scrollWidth <= innerWidth, "Release controls must fit viewport");
  document.getElementById("browserResult").textContent = "PASS: overlay layout, close/keyboard behavior, contact rows, multiple faxes, formatted E.164 selection, manual fallback, X, refresh guarding, lock and Clear All";
} catch (error) { document.getElementById("browserResult").textContent = "FAIL: " + error.stack; }
`;
html = html.replace("</body>", () => `<pre id="browserResult">RUNNING</pre><script>window.addEventListener("error", event => { document.getElementById("browserResult").textContent = "FAIL: " + event.message; });</script><script>${zipLibrary}</script><script type="module">${script}</script></body>`);
const path = join(directory, "check.html");
await writeFile(path, html);
for (const viewport of ["1280,900", "390,844"]) {
  const { stdout } = await promisify(execFile)(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--screenshot=${join(directory, 'fax-' + viewport + '.png')}`,
    `--user-data-dir=${join(directory, 'profile-' + viewport)}`, `--window-size=${viewport}`, "--dump-dom", "--virtual-time-budget=30000", pathToFileURL(path).href
  ], { timeout: 60_000, maxBuffer: 2_000_000, windowsHide: true });
  await writeFile(join(directory, "dom-" + viewport + ".html"), stdout);
  const result = stdout.match(/<pre id="browserResult">([\s\S]*?)<\/pre>/)?.[1] || "FAIL: no browser result";
  console.log(`${viewport}: ${result}`);
  console.log(`Screenshot: ${join(directory, 'fax-' + viewport + '.png')}`);
  if (!result.startsWith("PASS:")) process.exitCode = 1;
}
