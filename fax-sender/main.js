import { FaxBatch, validFaxNumber, normalizeFaxNumber } from "./batch.js";

const form = document.getElementById("faxForm");
const numberInput = document.getElementById("faxNumber");
const fileInput = document.getElementById("pdfFile");
const button = document.getElementById("sendFax");
const retryButton = document.getElementById("retryFailed");
const clearButton = document.getElementById("clearAll");
const validation = document.getElementById("validation");
const result = document.getElementById("faxResult");
const list = document.getElementById("documentList");
const batch = new FaxBatch({ onChange: render });

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function rowAction(label, action) {
  const control = element("button", label, "secondary-btn");
  control.type = "button";
  control.disabled = batch.busy;
  control.addEventListener("click", action);
  return control;
}

function render() {
  const docs = batch.documents;
  const ready = docs.filter(doc => doc.state === "Ready").length;
  const failed = docs.filter(doc => doc.state === "Failed").length;
  const submitted = docs.filter(doc => doc.messageId).length;
  const delivered = docs.filter(doc => doc.state === "Delivered").length;
  const unknown = docs.filter(doc => doc.state === "Status Unknown").length;
  const tracking = docs.some(doc => doc.tracking);
  const summary = docs.length && delivered === docs.length ? `${delivered} of ${docs.length} faxes delivered.` :
    `${delivered} delivered; ${failed} failed${unknown ? `; ${unknown} status unknown` : ""}${ready ? `; ${ready} ready` : ""}.`;
  const number = batch.destination || normalizeFaxNumber(numberInput.value);
  const valid = validFaxNumber(number);
  numberInput.disabled = batch.busy || Boolean(batch.destination);
  fileInput.disabled = batch.busy;
  button.disabled = batch.busy || !valid || !ready;
  button.hidden = !ready;
  button.textContent = `Send ${ready} ${ready === 1 ? "Fax" : "Faxes"}`;
  retryButton.hidden = !failed;
  retryButton.disabled = batch.busy || !valid;
  retryButton.textContent = `Retry Failed (${failed})`;
  clearButton.disabled = batch.busy || (!docs.length && !batch.destination);
  form.setAttribute("aria-busy", String(batch.busy));
  document.getElementById("documentCount").textContent = `Documents — ${docs.length}`;
  document.getElementById("batchReview").textContent = batch.adding
    ? "Checking selected PDFs…"
    : ready ? `${ready} documents ready to fax separately${valid ? ` to ${number}` : ". Enter a valid LO fax number"}.`
    : tracking ? `${submitted} of ${docs.length} submitted. Checking delivery status…`
    : docs.length ? summary : "Select PDFs to begin.";
  document.getElementById("numberHelp").textContent = batch.destination
    ? `Batch destination: ${batch.destination}. Clear All to start a new batch with another number.`
    : "Include + and the country code (+1 for US numbers). All documents go to this number.";
  document.getElementById("retryHelp").hidden = !failed;
  result.textContent = batch.running
    ? `Submitting fax ${batch.progress.current} of ${batch.progress.total}${batch.progress.name ? `: ${batch.progress.name}` : ""}. ${submitted} / ${docs.length} submitted; ${failed} failed.`
    : docs.length ? `${summary}${tracking ? " Checking delivery status…" : ""}` : "No documents selected.";
  result.dataset.complete = String(Boolean(docs.length) && delivered === docs.length);

  list.replaceChildren();
  for (const doc of docs) {
    const row = element("li", "", "fax-document");
    row.dataset.state = doc.state;
    const details = element("div", "", "fax-document-details");
    details.append(element("strong", doc.file.name, "fax-filename"));
    details.append(element("span", `${(doc.file.size / 1_000_000).toFixed(2)} MB`, "fax-size"));
    if (doc.messageId) {
      details.append(element("p", `Message ID: ${doc.messageId} · RingCentral status: ${doc.status || "Not yet available"}`));
    }
    if (doc.history.length) {
      const history = document.createElement("details");
      history.append(element("summary", "Previous attempts"));
      for (const attempt of doc.history) history.append(element("p", `Message ID: ${attempt.messageId} · RingCentral status: ${attempt.status}`));
      details.append(history);
    }
    if (doc.state === "Status Unknown") details.append(element("p", "Status Unknown — Check RingCentral before retrying", "fax-error"));
    if (doc.error) details.append(element("p", doc.error, "fax-error"));
    const actions = element("div", "", "fax-document-actions");
    const label = { Submitting: "Submitting…", Queued: "Queued / Processing", Delivered: "✓ Delivered", Failed: "✕ Failed" }[doc.state] || doc.state;
    actions.append(element("span", label, "fax-state"));
    if (doc.retryable) {
      const retry = rowAction("Retry", () => batch.run(numberInput.value, "Failed", doc.id));
      retry.setAttribute("aria-label", `Retry ${doc.file.name}`);
      actions.append(retry);
    }
    if (doc.state === "Ready") {
      const remove = rowAction("Remove", () => batch.remove(doc.id));
      remove.setAttribute("aria-label", `Remove ${doc.file.name}`);
      actions.append(remove);
    }
    row.append(details, actions);
    list.append(row);
  }
}

numberInput.addEventListener("input", render);
fileInput.addEventListener("change", async () => {
  const files = [...fileInput.files];
  fileInput.value = ""; // The list owns the files; subsequent selections add to it.
  validation.textContent = "";
  const errors = await batch.addFiles(files);
  validation.textContent = errors.join("\n");
});
form.addEventListener("submit", event => {
  event.preventDefault();
  batch.run(numberInput.value);
});
retryButton.addEventListener("click", () => batch.run(numberInput.value, "Failed"));
clearButton.addEventListener("click", () => {
  batch.clear();
  validation.textContent = "";
});
window.addEventListener("beforeunload", event => {
  if (!batch.running && !batch.documents.some(doc => doc.tracking)) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("pagehide", () => batch.tracker.clear());
render();
