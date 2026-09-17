import { FaxBatch, validFaxNumber, normalizeFaxNumber } from "./batch.js";

import { ContactPicker } from "./contacts.js";
import { downloadFaxAttachment, lookupFaxMessage, receiptFilename, validLastFour } from "./message.js";

const form = document.getElementById("faxForm");
const numberInput = document.getElementById("faxNumber");
const fileInput = document.getElementById("pdfFile");
const lastFourInput = document.getElementById("lastFourSsn");
const button = document.getElementById("sendFax");
const retryButton = document.getElementById("retryFailed");
const clearButton = document.getElementById("clearAll");
const validation = document.getElementById("validation");
const result = document.getElementById("faxResult");
const list = document.getElementById("documentList");
const batch = new FaxBatch({
  onChange: render,
  tracking: {
    onSent: async doc => {
      try {
        const details = await lookupFaxMessage(doc.messageId);
        if (doc.messageId === details.messageId) doc.transmissionDetails = details;
      } catch (error) {
        if (doc.messageId) doc.transmissionDetailsError = error.message;
      }
      render();
    }
  }
});
const contactPicker = new ContactPicker({
  root: document.getElementById("destinationControl"), dropdown: document.getElementById("contactDropdown"), clear: document.getElementById("clearDestination"),
  search: document.getElementById("contactSearch"), results: document.getElementById("contactResults"),
  message: document.getElementById("contactMessage"), reload: document.getElementById("reloadContacts"),
  numberInput, batch, onSelect: render
});

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
  contactPicker.render();
  const docs = batch.documents;
  renderHistory();
  const ready = docs.filter(doc => doc.state === "Ready").length;
  const failed = docs.filter(doc => doc.state === "Failed").length;
  // Keep the internal state names and retry rules unchanged; these are display labels only.
  const sent = docs.filter(doc => doc.state === "Delivered").length;
  const unknown = docs.filter(doc => doc.state === "Status Unknown").length;
  const tracking = docs.some(doc => doc.tracking);
  const allSent = Boolean(docs.length) && sent === docs.length;
  const summary = allSent ? (sent === 1 ? "✓ Fax sent successfully" : `✓ ${sent} faxes sent successfully`) :
    [sent ? `${sent} sent` : "", failed ? `${failed} failed` : "", unknown ? `${unknown} status unknown` : ""].filter(Boolean).join(" · ");
  const number = batch.destination || normalizeFaxNumber(numberInput.value);
  const valid = validFaxNumber(number);
  numberInput.disabled = batch.busy || Boolean(batch.destination);
  fileInput.disabled = batch.busy;
  button.disabled = batch.busy || !valid || !ready;
  button.hidden = !ready;
  button.textContent = ready === 1 ? "Send Fax" : `Send ${ready} Faxes`;
  retryButton.hidden = !failed;
  retryButton.disabled = batch.busy || !valid;
  retryButton.textContent = `Retry Failed (${failed})`;
  clearButton.disabled = batch.busy || (!docs.length && !batch.destination);
  form.setAttribute("aria-busy", String(batch.busy));
  document.getElementById("numberHelp").textContent = batch.destination
    ? "Destination locked for this batch. Clear All to choose another destination."
    : "";
  document.getElementById("numberHelp").hidden = !batch.destination;
  document.getElementById("retryHelp").hidden = !failed;
  result.textContent = batch.running
    ? `Sending ${Math.max(1, batch.progress.current)} of ${batch.progress.total}...`
    : tracking ? "Checking fax status..." : ready ? "" : summary;
  result.hidden = !result.textContent || !docs.some(doc => doc.attempts > 0);
  result.dataset.complete = String(allSent);

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
    if (doc.transmissionDetails) {
      const transmission = document.createElement("details");
      transmission.append(element("summary", "View Transmission Details"));
      transmission.append(element("p", doc.transmissionDetails.receiptNote));
      if (doc.transmissionDetails.faxPageCount) transmission.append(element("p", `${doc.transmissionDetails.faxPageCount} pages · ${doc.transmissionDetails.faxResolution || "Resolution unavailable"}`));
      for (const attachment of doc.transmissionDetails.attachments || []) {
        const attachmentRow = element("p", `${attachment.fileName} · ${attachment.contentType}`);
        if (attachment.downloadUrl) {
          const download = rowAction("Download Fax Receipt", async () => {
            const lastFour = batch.lastFourSsn;
            if (!validLastFour(lastFour)) {
              validation.textContent = "Enter exactly four digits in Last 4 of SSN before downloading a Fax Receipt.";
              lastFourInput.focus();
              return;
            }
            download.disabled = true;
            try { await downloadFaxAttachment(attachment.downloadUrl, receiptFilename(doc.file?.name, lastFour)); }
            catch (error) { doc.transmissionDetailsError = error.message; render(); }
          });
          attachmentRow.append(" ", download);
        }
        transmission.append(attachmentRow);
      }
      details.append(transmission);
    } else if (doc.transmissionDetailsError) {
      details.append(element("p", `Transmission details unavailable: ${doc.transmissionDetailsError}`, "fax-error"));
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
    const label = { Submitting: "Processing...", Queued: "Submitted", Delivered: "Sent ✓", Failed: "Failed" }[doc.state] || doc.state;
    if (doc.state !== "Ready") actions.append(element("span", label, "fax-state"));
    if (doc.retryable) {
      const retry = rowAction("Retry", () => batch.run(numberInput.value, "Failed", doc.id));
      retry.setAttribute("aria-label", `Retry ${doc.file.name}`);
      actions.append(retry);
    }
    if (doc.state === "Delivered" && !doc.transmissionDetails && (!doc.transmissionDetailsRequested || doc.transmissionDetailsError)) {
      const detailsButton = rowAction(doc.transmissionDetailsError ? "Retry Transmission Details" : "View Fax Receipt Details", async () => {
        doc.transmissionDetailsRequested = true;
        doc.transmissionDetailsError = "";
        try { doc.transmissionDetails = await lookupFaxMessage(doc.messageId); }
        catch (error) { doc.transmissionDetailsError = error.message; }
        render();
      });
      actions.append(detailsButton);
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

function renderHistory() {
  const historyList = document.getElementById("faxHistoryList");
  const entries = batch.recentFaxes;
  document.getElementById("faxHistoryEmpty").hidden = Boolean(entries.length);
  historyList.replaceChildren();
  for (const entry of entries) {
    const row = element("li", "", "fax-history-entry");
    const label = { Submitting: "Processing...", Queued: "Submitted", Delivered: "Sent ✓", Failed: "Failed" }[entry.state] || "Status Unknown";
    row.append(element("strong", entry.recipientName || entry.faxNumber));
    if (entry.recipientName) row.append(element("span", entry.faxNumber));
    row.append(element("span", entry.filename));
    const time = element("time", `Attempted ${new Date(entry.attemptedAt).toLocaleString()}`);
    time.dateTime = entry.attemptedAt;
    row.append(time, element("span", `${label} · 1 document`, "fax-state"));
    if (entry.messageId) row.append(element("span", `Message ID: ${entry.messageId}`));
    if (entry.status) row.append(element("span", `RingCentral status: ${entry.status}`));
    if (entry.state === "Status Unknown") row.append(element("span", "Check RingCentral before retrying."));
    historyList.append(row);
  }
}

const historyPanel = document.getElementById("faxHistory");
const historyDesktop = window.matchMedia("(min-width: 1100px)");
function setHistoryLayout() { historyPanel.open = historyDesktop.matches; }
historyDesktop.addEventListener("change", setHistoryLayout);
setHistoryLayout();

numberInput.addEventListener("input", render);
lastFourInput.addEventListener("input", () => {
  batch.lastFourSsn = lastFourInput.value;
});
fileInput.addEventListener("change", async () => {
  const files = [...fileInput.files];
  fileInput.value = ""; // The list owns the files; subsequent selections add to it.
  validation.textContent = "";
  const errors = await batch.addFiles(files);
  validation.textContent = errors.join("\n");
});
form.addEventListener("submit", event => {
  event.preventDefault();
  batch.run(numberInput.value, "Ready", null, contactPicker.selectedName);
});
retryButton.addEventListener("click", () => batch.run(numberInput.value, "Failed"));
clearButton.addEventListener("click", () => {
  batch.clear();
  contactPicker.clear();
  lastFourInput.value = "";
  validation.textContent = "";
});
window.addEventListener("beforeunload", event => {
  if (!batch.running && !batch.documents.some(doc => doc.tracking)) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("pagehide", () => batch.tracker.clear());
render();
