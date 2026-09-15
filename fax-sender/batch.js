export function normalizeFaxNumber(value) {
  return value.replace(/[\s().-]/g, "");
}

export function validFaxNumber(value) {
  return /^\+[1-9]\d{7,14}$/.test(normalizeFaxNumber(value));
}

const uncertainSubmission = "Submission could not be confirmed. Check RingCentral's sent faxes before retrying to avoid duplicates.";

// Reuse the production API: every call contains one recipient and one file.
export async function submitDocument(file, faxNumber) {
  const body = new FormData();
  body.append("faxNumber", faxNumber);
  body.append("file", file);
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

// Tab-only state. No PDFs or results are written to browser storage.
export class FaxBatch {
  constructor({ submit = submitDocument, onChange = () => {}, pause = () => new Promise(resolve => setTimeout(resolve, 1000)) } = {}) {
    this.documents = [];
    this.destination = "";
    this.running = false;
    this.adding = false;
    this.progress = null;
    this.submit = submit;
    this.onChange = onChange;
    this.pause = pause;
    this.nextId = 1;
  }

  get busy() { return this.running || this.adding; }

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
        this.documents.push({ id: this.nextId++, file, state: "Ready", messageId: null, status: null, error: "", attempts: 0 });
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
    this.documents = this.documents.filter(doc => doc.id !== id || doc.messageId);
    this.onChange();
  }

  clear() {
    if (this.busy) return;
    this.documents = [];
    this.destination = "";
    this.progress = null;
    this.onChange();
  }

  async run(number, state = "Ready", onlyId = null) {
    if (this.busy || !["Ready", "Failed"].includes(state)) return;
    const destination = this.destination || normalizeFaxNumber(number);
    if (!validFaxNumber(destination)) return;
    // Snapshot eligible rows. Submitted documents can never enter the queue.
    const queue = this.documents.filter(doc => doc.state === state && !doc.messageId &&
      (onlyId === null || doc.id === onlyId));
    if (!queue.length) return;
    this.destination = destination;
    this.running = true;
    this.progress = { current: 0, total: queue.length, name: "" };
    this.onChange();
    try {
      for (const [index, doc] of queue.entries()) {
        doc.state = "Sending";
        doc.error = "";
        doc.attempts++;
        this.progress = { current: index + 1, total: queue.length, name: doc.file.name };
        this.onChange();
        try {
          const result = await this.submit(doc.file, destination);
          if (!result?.messageId) throw new Error(uncertainSubmission);
          doc.messageId = result.messageId;
          doc.status = result.status;
          doc.state = "Submitted";
        } catch (error) {
          doc.state = "Failed";
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
