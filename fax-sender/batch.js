import { FaxTracker } from "./tracking.js";
import { validLastFour } from "./message.js";
import { browserHistoryStorage, loadFaxHistory, saveFaxHistory } from "./history.js";

export function normalizeFaxNumber(value) {
  return value.replace(/[\s().-]/g, "");
}

export function validFaxNumber(value) {
  return /^\+[1-9]\d{7,14}$/.test(normalizeFaxNumber(value));
}

const uncertainSubmission = "Submission could not be confirmed. Check RingCentral's sent faxes before retrying to avoid duplicates.";

// Metadata only: never retain the PDF in recent history.
function attemptSummary(doc) {
  const { messageId, status, state, attemptedAt, sequence, recipientName, faxNumber, lastFourSsn } = doc;
  return { messageId, status, state, attemptedAt, sequence, recipientName, faxNumber, lastFourSsn, filename: doc.file.name };
}

// Reuse the production API: every call contains one recipient and one file.
export async function submitDocument(file, faxNumber, { includeCoverSheet = true, recipientName = "", coverPageText = "" } = {}) {
  const body = new FormData();
  body.append("faxNumber", faxNumber);
  body.append("file", file);
  body.append("includeCoverSheet", String(includeCoverSheet));
  if (includeCoverSheet && recipientName) body.append("recipientName", recipientName);
  if (includeCoverSheet && coverPageText.trim()) body.append("coverPageText", coverPageText.trim());
  let response;
  try {
    response = await fetch("/api/send-fax", {
      method: "POST", body, signal: AbortSignal.timeout(65_000)
    });
  } catch {
    throw new Error(uncertainSubmission);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || (response.status === 413
      ? "The upload is too large. Select a PDF under 4 MB."
      : uncertainSubmission));
  }
  if (!/^\d+$/.test(String(data.messageId))) throw new Error(uncertainSubmission);
  return { messageId: String(data.messageId), status: data.status || "Accepted" };
}

async function validatePdf(file) {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) return "Only PDF files are accepted.";
  if (!file.size || file.size > 4_000_000) return "Select a nonempty PDF of 4 MB or smaller.";
  try {
    if (await file.slice(0, 5).text() !== "%PDF-") return "This file does not have a PDF header.";
  } catch {
    return "This file could not be read. Select it again.";
  }
  return "";
}

// Documents are tab-only. History persists allowlisted metadata, including four-digit Last 4.
export class FaxBatch {
  constructor({ submit = submitDocument, onChange = () => {}, onValidationError = () => {}, pause = () => new Promise(resolve => setTimeout(resolve, 1000)), tracking = {}, storage = browserHistoryStorage() } = {}) {
    this.documents = [];
    this.destination = "";
    this.running = false;
    this.adding = false;
    this.progress = null;
    this.submit = submit;
    this.onChange = () => {
      this.historySaved = saveFaxHistory(storage, this.recentFaxes);
      onChange();
    };
    this.onValidationError = onValidationError;
    this.pause = pause;
    this.nextId = 1;
    this.recentArchive = loadFaxHistory(storage);
    this.nextAttempt = 11;
    this.historySaved = Boolean(storage);
    this.recipientName = "";
    this.lastFourSsn = "";
    this.includeCoverSheet = true;
    this.coverPageText = "";
    this.coverSettings = null;
    this.tracker = new FaxTracker({ ...tracking, onChange: this.onChange });
  }

  get busy() { return this.running || this.adding; }

  get recentFaxes() {
    return [...this.recentArchive, ...this.documents.flatMap(doc =>
      doc.attempts ? [...doc.history, attemptSummary(doc)] : [])]
      .sort((a, b) => b.sequence - a.sequence).slice(0, 10);
  }

  async addFiles(files) {
    if (this.busy) return [];
    this.adding = true;
    this.onChange();
    const errors = [];
    try {
      for (const file of files) {
        const error = await validatePdf(file);
        if (error) { errors.push(`${file.name}: ${error}`); continue; }
        const duplicate = this.documents.some(doc => doc.file.name === file.name &&
          doc.file.size === file.size && doc.file.lastModified === file.lastModified);
        if (duplicate) { errors.push(`${file.name}: Already in this list; not added again.`); continue; }
        this.documents.push({ id: this.nextId++, file, state: "Ready", messageId: null, status: null, error: "", attempts: 0, history: [], retryable: false, tracking: false, transmissionDetails: null, transmissionDetailsError: "", transmissionDetailsRequested: false });
      }
    } finally {
      this.adding = false;
      this.onChange();
    }
    return errors;
  }

  remove(id) {
    if (this.busy) return;
    // Preserve submitted results until the user explicitly clears the whole batch.
    this.documents = this.documents.filter(doc => doc.id !== id || doc.state !== "Ready");
    this.onChange();
  }

  clear() {
    if (this.busy) return;
    // Clear both live and restored attempts; onChange persists the empty history.
    this.recentArchive = [];
    this.tracker.clear();
    this.documents = [];
    this.destination = "";
    this.recipientName = "";
    this.lastFourSsn = "";
    this.includeCoverSheet = true;
    this.coverPageText = "";
    this.coverSettings = null;
    this.progress = null;
    this.onChange();
  }

  async run(number, state = "Ready", onlyId = null, recipientName = "") {
    if (this.busy || !["Ready", "Failed"].includes(state)) return;
    const destination = this.destination || normalizeFaxNumber(number);
    if (!validFaxNumber(destination)) return;
    // Snapshot eligible rows. Submitted documents can never enter the queue.
    const queue = this.documents.filter(doc => doc.state === state && (state === "Ready" ? !doc.messageId : doc.retryable) &&
      (onlyId === null || doc.id === onlyId));
    if (!queue.length) return;
    if (!validLastFour(this.lastFourSsn)) {
      this.onValidationError("Enter the client's 4-digit SSN last four before sending.");
      return;
    }
    const lastFourSsn = this.lastFourSsn; // Snapshot once; edits during the queue cannot relabel prior attempts.
    if (!this.destination) this.recipientName = recipientName;
    const comment = this.coverSettings?.coverPageText ?? (this.includeCoverSheet ? this.coverPageText.replace(/\r\n?/g, "\n").trim() : "");
    if (comment.length > 1024) {
      this.onValidationError("Cover-sheet comments must be 1024 characters or fewer.");
      return;
    }
    // Retain the first settings for all documents, later additions, and explicit retries.
    this.coverSettings ||= Object.freeze({ includeCoverSheet: this.includeCoverSheet, recipientName: this.recipientName, coverPageText: comment });
    const coverOptions = this.coverSettings;
    this.destination = destination;
    this.running = true;
    this.progress = { current: 0, total: queue.length, name: "" };
    this.onChange();
    try {
      for (const [index, doc] of queue.entries()) {
        if (doc.messageId) doc.history.push(attemptSummary(doc));
        doc.attemptedAt = new Date().toISOString();
        doc.sequence = this.nextAttempt++;
        doc.lastFourSsn = lastFourSsn;
        doc.recipientName = this.recipientName;
        doc.faxNumber = destination;
        doc.messageId = null;
        doc.status = null;
        doc.transmissionDetails = null;
        doc.transmissionDetailsError = "";
        doc.transmissionDetailsRequested = false;
        doc.retryable = false;
        doc.state = "Submitting";
        doc.error = "";
        doc.attempts++;
        this.progress = { current: index + 1, total: queue.length, name: doc.file.name };
        this.onChange();
        try {
          const result = await this.submit(doc.file, destination, coverOptions);
          if (!result?.messageId) throw new Error(uncertainSubmission);
          doc.messageId = result.messageId;
          doc.status = ["Queued", "Sent", "SendingFailed", "Delivered", "DeliveryFailed", "Received"].includes(result.status) ? result.status : null;
          this.tracker.start(doc);
        } catch (error) {
          doc.state = "Status Unknown";
          doc.error = error instanceof Error ? error.message : uncertainSubmission;
        }
        this.onChange();
        if (index < queue.length - 1) await this.pause();
      }
    } finally {
      this.running = false;
      this.progress = null;
      this.onChange();
    }
  }
}
