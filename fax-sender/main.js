import { FaxBatch, validFaxNumber, normalizeFaxNumber } from "./batch.js";

import { ContactPicker, formatFaxNumber } from "./contacts.js";
import { faxStatusLabel } from "./tracking.js";
import { downloadFaxAttachment, fetchFaxAttachment, lookupFaxMessage, receiptFilename, validLastFour } from "./message.js";
import { downloadReceiptZip } from "./receipts-zip.js";

const form = document.getElementById("faxForm");
const numberInput = document.getElementById("faxNumber");
const fileInput = document.getElementById("pdfFile");
const chooseFilesButton = document.getElementById("choosePdfFiles");
const coverCommentInput = document.getElementById("coverPageText");
const coverCommentField = document.getElementById("coverCommentField");
const coverSheetInput = document.getElementById("includeCoverSheet");
const coverSheetState = document.getElementById("coverSheetState");
const lastFourInput = document.getElementById("lastFourSsn");
const button = document.getElementById("sendFax");
const retryButton = document.getElementById("retryFailed");
const clearButton = document.getElementById("clearAll");
const validation = document.getElementById("validation");
const result = document.getElementById("faxResult");
const list = document.getElementById("documentList");
const downloadAllButton = document.getElementById("downloadAllReceipts");
const downloadZipButton = document.getElementById("downloadReceiptZip");
let downloadingAll = false;
const historyViews = new Map(); // DOM/receipt cache only; persisted records stay in FaxBatch.
const batch = new FaxBatch({
  onChange: render,
  onValidationError: message => {
    validation.textContent = message;
    (message.startsWith("Cover-sheet") ? coverCommentInput : lastFourInput).focus();
  },
  tracking: {
    onSent: async doc => {
      doc.receiptError = "";
      try {
        const details = await lookupFaxMessage(doc.messageId);
        if (doc.messageId === details.messageId) {
          doc.transmissionDetails = details;
          if (!receiptAttachment(doc)) doc.receiptError = "Fax Receipt is unavailable for this fax.";
        }
      } catch (error) {
        if (doc.messageId) {
          doc.transmissionDetailsError = error.message;
          doc.receiptError = error.message;
        }
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

function rowAction(label, action, className = "secondary-btn") {
  const control = element("button", label, className);
  control.type = "button";
  control.disabled = batch.busy;
  control.addEventListener("click", action);
  return control;
}

function receiptAttachment(doc) {
  return doc.transmissionDetails?.attachments?.find(attachment => attachment.type === "RenderedDocument" && attachment.downloadUrl);
}

function receiptAction(doc, attachment) {
  const download = rowAction(doc.receiptError ? "Retry Fax Receipt" : "Download Fax Receipt", async () => {
    const lastFour = batch.lastFourSsn;
    if (!validLastFour(lastFour)) {
      validation.textContent = "Enter exactly four digits in Last 4 of SSN before downloading a Fax Receipt.";
      lastFourInput.focus();
      return;
    }
    doc.receiptDownloading = true;
    render();
    try {
      await downloadFaxAttachment(attachment.downloadUrl, receiptFilename(doc.file?.name, lastFour), attachment);
      doc.receiptError = "";
    } catch (error) {
      doc.receiptError = error.message;
    } finally { doc.receiptDownloading = false; render(); }
  }, "primary-btn");
  download.setAttribute("aria-label", `${doc.receiptError ? "Retry" : "Download"} Fax Receipt for ${doc.file.name}`);
  download.disabled = downloadingAll || Boolean(doc.receiptDownloading);
  return download;
}

function render() {
  contactPicker.render();
  const docs = batch.documents;
  renderHistory();
  const ready = docs.filter(doc => doc.state === "Ready").length;
  const failed = docs.filter(doc => doc.state === "Failed").length;
  // Keep the internal state names and retry rules unchanged; these are display labels only.
  const sent = docs.filter(doc => doc.state === "Delivered").length;
  const available = docs.filter(doc => doc.state === "Delivered" && receiptAttachment(doc)).length;
  document.getElementById("batchReceipts").hidden = !sent;
  downloadAllButton.disabled = downloadingAll || !available || docs.some(doc => doc.receiptDownloading);
  downloadZipButton.disabled = downloadAllButton.disabled;
  downloadAllButton.textContent = downloadingAll ? "Downloading Fax Receipts…" : "Download All Fax Receipts";
  document.getElementById("receiptAvailability").textContent = `${available} of ${sent} sent fax receipts available.${sent > available ? " Remaining receipts are preparing or unavailable; see each document below." : ""}`;
  const unknown = docs.filter(doc => doc.state === "Status Unknown").length;
  const tracking = docs.some(doc => doc.tracking);
  const allSent = Boolean(docs.length) && sent === docs.length;
  const summary = allSent ? (sent === 1 ? "✓ Fax sent successfully" : `✓ ${sent} faxes sent successfully`) :
    [sent ? `${sent} sent` : "", failed ? `${failed} failed` : "", unknown ? `${unknown} status unknown` : ""].filter(Boolean).join(" · ");
  const number = batch.destination || normalizeFaxNumber(numberInput.value);
  const valid = validFaxNumber(number);
  numberInput.disabled = batch.busy || Boolean(batch.destination);
  coverCommentInput.value = batch.coverPageText;
  coverCommentField.hidden = !batch.includeCoverSheet;
  coverCommentInput.disabled = !batch.includeCoverSheet || batch.busy || Boolean(batch.destination);
  coverSheetInput.checked = batch.includeCoverSheet;
  coverSheetInput.disabled = batch.busy || Boolean(batch.destination);
  coverSheetState.textContent = batch.includeCoverSheet ? "ON - RingCentral Classic" : "OFF - No cover sheet";
  fileInput.disabled = batch.busy;
  chooseFilesButton.disabled = fileInput.disabled;
  button.disabled = batch.busy || !valid || !ready;
  button.hidden = !ready;
  button.textContent = ready === 1 ? "Send Fax" : `Send ${ready} Faxes`;
  retryButton.hidden = !failed;
  retryButton.disabled = batch.busy || !valid;
  retryButton.textContent = `Retry Failed (${failed})`;
  clearButton.disabled = batch.busy || contactPicker.saving || downloadingAll;
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
    const label = faxStatusLabel(doc.state) + (doc.state === "Delivered" ? " ✓" : "");
    if (doc.state !== "Ready") actions.append(element("span", label, "fax-state"));
    const attachment = receiptAttachment(doc);
    if (doc.state === "Delivered" && attachment) actions.append(receiptAction(doc, attachment));
    if (doc.state === "Delivered" && !attachment && !doc.transmissionDetails && !doc.transmissionDetailsError) {
      actions.append(element("span", "Preparing receipt...", "fax-receipt-status"));
    }
    if (doc.receiptError) actions.append(element("span", `Receipt unavailable: ${doc.receiptError}`, "fax-error"));
    if (doc.retryable) {
      const retry = rowAction("Retry", () => batch.run(numberInput.value, "Failed", doc.id));
      retry.setAttribute("aria-label", `Retry ${doc.file.name}`);
      actions.append(retry);
    }
    if (doc.state === "Delivered" && !attachment && (doc.transmissionDetails || !doc.transmissionDetailsRequested || doc.transmissionDetailsError)) {
      const detailsButton = rowAction(doc.transmissionDetailsError ? "Retry Fax Receipt Lookup" : "View Fax Receipt Details", async () => {
        doc.transmissionDetailsRequested = true;
        doc.transmissionDetailsError = "";
        detailsButton.disabled = true;
        try {
          doc.transmissionDetails = await lookupFaxMessage(doc.messageId);
          doc.receiptError = receiptAttachment(doc) ? "" : "Fax Receipt is unavailable for this fax.";
        }
        catch (error) { doc.transmissionDetailsError = error.message; doc.receiptError = error.message; }
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

function createHistoryView() {
  const row = element("li", "", "fax-history-entry");
  const pill = document.createElement("details");
  const header = document.createElement("summary");
  const copy = element("span", "", "fax-history-copy");
  const title = element("strong", "", "fax-history-title");
  const subtitle = element("span", "", "fax-history-meta");
  const recipient = element("span", "");
  const time = document.createElement("time");
  subtitle.append(recipient, document.createTextNode(" • "), time);
  copy.append(title, subtitle);
  const status = element("span", "", "fax-history-status");
  const icon = element("span", "", "fax-history-icon");
  icon.setAttribute("aria-hidden", "true");
  const statusText = element("span", "");
  status.append(icon, statusText);
  header.append(copy, status);
  const body = element("div", "", "fax-history-body");
  const message = element("p", "");
  const rawStatus = element("p", "");
  const feedback = element("p", "", "fax-receipt-status");
  feedback.setAttribute("role", "status");
  const view = { row, pill, title, recipient, time, status, statusText, message, rawStatus, feedback, receipt: {}, downloading: false };
  const download = rowAction("Download Fax Receipt", async () => {
    const entry = view.entry;
    if (view.downloading || entry.state !== "Delivered" || !entry.messageId) return;
    view.downloading = true;
    download.disabled = true;
    feedback.textContent = "Preparing receipt…";
    try {
      // Share active attachment metadata/cache when present; restored history needs only its message ID.
      const source = batch.documents.find(doc => doc.messageId === entry.messageId) || view.receipt;
      if (!receiptAttachment(source)) source.transmissionDetails = await lookupFaxMessage(entry.messageId);
      const attachment = receiptAttachment(source);
      if (!attachment) throw new Error("Fax Receipt is unavailable for this fax.");
      if (!historyViews.has(entry.sequence)) return; // An evicted history entry no longer needs a local download.
      await downloadFaxAttachment(attachment.downloadUrl, receiptFilename(entry.filename, entry.lastFourSsn), attachment);
      feedback.textContent = "Receipt download requested.";
    } catch (error) {
      feedback.textContent = error.message;
      // Receipt errors never change transmission status or enable fax retries.
    } finally {
      view.downloading = false;
      download.disabled = false;
    }
  }, "primary-btn");
  view.download = download;
  body.append(message, rawStatus, download, feedback);
  pill.append(header, body);
  row.append(pill);
  return view;
}

function renderHistory() {
  document.getElementById("historyStorageStatus").hidden = batch.historySaved;
  const historyList = document.getElementById("faxHistoryList");
  const entries = batch.recentFaxes;
  document.getElementById("faxHistoryEmpty").hidden = Boolean(entries.length);
  const retained = new Set(entries.map(entry => entry.sequence));
  for (const [key, view] of historyViews) {
    if (!retained.has(key)) { view.row.remove(); historyViews.delete(key); }
  }
  for (const [index, entry] of entries.entries()) {
    let view = historyViews.get(entry.sequence);
    if (!view) { view = createHistoryView(); historyViews.set(entry.sequence, view); }
    view.entry = entry;
    view.title.textContent = entry.filename + (validLastFour(entry.lastFourSsn) ? " " + entry.lastFourSsn : "");
    view.recipient.textContent = entry.recipientName || formatFaxNumber(entry.faxNumber);
    view.time.textContent = new Date(entry.attemptedAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    view.time.dateTime = entry.attemptedAt;
    view.status.dataset.status = entry.state;
    view.statusText.textContent = entry.state === "Failed" ? "Error" : faxStatusLabel(entry.state);
    view.message.textContent = "Message ID: " + (entry.messageId || "Not available");
    view.rawStatus.textContent = entry.state === "Status Unknown" ? "Check RingCentral before retrying." : (entry.status ? "RingCentral status: " + entry.status : "");
    view.rawStatus.hidden = !view.rawStatus.textContent;
    view.download.hidden = entry.state !== "Delivered" || !entry.messageId;
    view.download.disabled = view.downloading;
    view.download.setAttribute("aria-label", "Download Fax Receipt for " + entry.filename);
    // Preserve native expansion and keyboard focus across status/queue renders.
    if (historyList.children[index] !== view.row) historyList.insertBefore(view.row, historyList.children[index] || null);
  }
}

async function downloadReceipts(asZip = false) {
  if (downloadingAll || batch.documents.some(doc => doc.receiptDownloading)) return;
  const lastFour = batch.lastFourSsn;
  if (!validLastFour(lastFour)) {
    validation.textContent = "Enter exactly four digits in Last 4 of SSN before downloading Fax Receipts.";
    lastFourInput.focus(); return;
  }
  const documents = batch.documents.filter(doc => doc.state === "Delivered" && receiptAttachment(doc));
  downloadingAll = true;
  const status = document.getElementById("receiptDownloadStatus");
  let requested = 0;
  const failures = [];
  const receipts = [];
  render();
  try {
    for (const doc of documents) {
      status.textContent = `Requesting receipt ${requested + failures.length + 1} of ${documents.length}…`;
      try {
        const attachment = receiptAttachment(doc);
        const filename = receiptFilename(doc.file.name, lastFour);
        if (asZip) receipts.push({ filename, blob: await fetchFaxAttachment(attachment.downloadUrl, attachment) });
        else await downloadFaxAttachment(attachment.downloadUrl, filename, attachment);
        doc.receiptError = ""; requested++;
      } catch (error) { doc.receiptError = error.message; failures.push(doc.file.name); }
    }
    if (asZip && receipts.length) await downloadReceiptZip(receipts);
    status.textContent = (asZip ? `${requested} receipts included in the ZIP download request.` : `${requested} PDF download${requested === 1 ? "" : "s"} requested. Check your browser's downloads; blocked downloads cannot be detected here. Use the ZIP fallback or individual buttons if needed.`) +
      (failures.length ? ` Could not retrieve: ${failures.join(", ")}.` : "");
  } catch { status.textContent = "Could not prepare the ZIP. Use the individual Download Fax Receipt buttons."; }
  finally { downloadingAll = false; render(); }
}
downloadAllButton.addEventListener("click", () => downloadReceipts());
downloadZipButton.addEventListener("click", () => downloadReceipts(true));

const historyPanel = document.getElementById("faxHistory");
const historyDesktop = window.matchMedia("(min-width: 1100px)");
function setHistoryLayout() { historyPanel.open = historyDesktop.matches; }
historyDesktop.addEventListener("change", setHistoryLayout);
setHistoryLayout();

numberInput.addEventListener("input", render);
coverCommentInput.addEventListener("input", () => {
  if (!batch.busy && !batch.destination) batch.coverPageText = coverCommentInput.value;
  render();
});
coverSheetInput.addEventListener("change", () => {
  if (!batch.busy && !batch.destination) batch.includeCoverSheet = coverSheetInput.checked;
  render();
});

lastFourInput.addEventListener("input", () => {
  batch.lastFourSsn = lastFourInput.value;
  if (validLastFour(batch.lastFourSsn)) validation.textContent = "";
});
chooseFilesButton.addEventListener("click", () => fileInput.click());
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
  fileInput.value = "";
  validation.textContent = "";
  document.getElementById("receiptDownloadStatus").textContent = "";
});
window.addEventListener("beforeunload", event => {
  if (!batch.running && !batch.documents.some(doc => doc.tracking)) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("pagehide", () => batch.tracker.clear());
render();
