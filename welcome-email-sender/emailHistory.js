export const EMAIL_HISTORY_LIMIT = 20;
export const EMAIL_HISTORY_KEY = "packard-welcome-email-history";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Persist only the display metadata needed by Email History. Email bodies,
// attachments, Outlook IDs, tokens, and draft links are never stored.
export function emailHistoryRecords(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter(entry => entry &&
    typeof entry.id === "string" && entry.id.length > 0 && entry.id.length <= 180 &&
    typeof entry.recipient === "string" && entry.recipient.length <= 254 && emailPattern.test(entry.recipient) &&
    typeof entry.subject === "string" &&
    typeof entry.managerName === "string" &&
    ["english", "spanish"].includes(entry.language) &&
    typeof entry.createdAt === "string" && Number.isFinite(Date.parse(entry.createdAt)))
    .slice(0, EMAIL_HISTORY_LIMIT)
    .map(entry => ({
      id: entry.id,
      recipient: entry.recipient,
      subject: entry.subject.slice(0, 500),
      managerName: entry.managerName.slice(0, 180),
      language: entry.language,
      createdAt: entry.createdAt,
    }));
}

export function addEmailHistory(entries, entry) {
  return emailHistoryRecords([entry, ...emailHistoryRecords(entries)]);
}

export function loadEmailHistory(storage) {
  try { return emailHistoryRecords(JSON.parse(storage?.getItem(EMAIL_HISTORY_KEY) || "[]")); }
  catch { return []; }
}

export function saveEmailHistory(storage, entries) {
  try {
    if (!storage) return false;
    storage.setItem(EMAIL_HISTORY_KEY, JSON.stringify(emailHistoryRecords(entries)));
    return true;
  } catch { return false; }
}

export function browserEmailHistoryStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function createEmailHistoryEntry({ recipient, subject, managerName, language }, now = new Date()) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `email-${now.getTime()}-${Math.random().toString(36).slice(2, 9)}`,
    recipient,
    subject,
    managerName,
    language,
    createdAt: now.toISOString(),
  };
}
