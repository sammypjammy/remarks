import { validLastFour } from "./message.js";

export const FAX_HISTORY_LIMIT = 20;
export const FAX_HISTORY_KEY = "packard.faxHistory.v1";
const states = ["Submitting", "Queued", "Delivered", "Failed", "Status Unknown"];

// Explicit allowlist: only four-digit Last 4, never full SSN, documents, receipt names or media URLs.
export function historyRecords(entries, restored = false) {
  if (!Array.isArray(entries)) return [];
  return entries.filter(entry => entry && typeof entry.filename === "string" &&
    typeof entry.attemptedAt === "string" && Number.isFinite(Date.parse(entry.attemptedAt)) &&
    typeof entry.faxNumber === "string" && /^\+[1-9]\d{7,14}$/.test(entry.faxNumber) &&
    states.includes(entry.state)).slice(0, FAX_HISTORY_LIMIT).map((entry, index) => ({
      filename: entry.filename.slice(0, 255),
      lastFourSsn: validLastFour(entry.lastFourSsn) ? entry.lastFourSsn : "",
      recipientName: typeof entry.recipientName === "string" ? entry.recipientName.slice(0, 180) : "",
      faxNumber: entry.faxNumber, attemptedAt: entry.attemptedAt,
      state: restored && !["Delivered", "Failed"].includes(entry.state) ? "Status Unknown" : entry.state,
      messageId: /^\d{1,30}$/.test(String(entry.messageId)) ? String(entry.messageId) : null,
      status: ["Queued", "Sent", "SendingFailed", "Delivered", "DeliveryFailed", "Received"].includes(entry.status) ? entry.status : null,
      sequence: FAX_HISTORY_LIMIT - index
    }));
}

export function loadFaxHistory(storage) {
  try { return historyRecords(JSON.parse(storage?.getItem(FAX_HISTORY_KEY) || "[]"), true); }
  catch { return []; }
}

export function saveFaxHistory(storage, entries) {
  try {
    if (!storage) return false;
    storage.setItem(FAX_HISTORY_KEY, JSON.stringify(historyRecords(entries)));
    return true;
  } catch { return false; }
}

export function browserHistoryStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}
