// Deliberately conservative: reject malformed addresses rather than repair them
// into a different recipient. Display names and common pasted wrappers are OK.
export function isValidBulkEmail(address) {
  if (typeof address !== "string" || address.length > 254) return false;
  const parts = address.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length > 0 && local.length <= 64 &&
    /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i.test(local) &&
    domain.includes(".") && domain.split(".").every(label =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) &&
    /^[a-z]{2,63}$/i.test(domain.split(".").at(-1));
}

export function parseBulkRecipients(text) {
  const recipients = [];
  const invalid = [];
  const seen = new Set();
  let found = 0;
  let duplicates = 0;
  // A Markdown mail link represents one entry, not two addresses.
  const cleaned = String(text).replace(/\[[^\]]*\]\(mailto:([^\s)]+)\)/gi, "$1")
    .replace(/(^|[,;\n])[^@,;\n<>]*<([^<>]*)>/g, "$1$2");
  for (const raw of cleaned.split(/[\s,;]+/).filter(Boolean)) {
    const address = raw.replace(/^mailto:/i, "").replace(/^[\[("<]+|[\])">]+$/g, "").toLowerCase();
    if (!address) continue;
    found++;
    if (!isValidBulkEmail(address)) invalid.push(raw);
    else if (seen.has(address)) duplicates++;
    else {
      seen.add(address);
      recipients.push(address);
    }
  }
  return { recipients, invalid, found, duplicates };
}

// Reserve every tab before the first await, while the button click still has activation.
export async function openBulkDrafts({ text, content, createDraft, composeUrl, authorize,
  openWindow = () => window.open("about:blank", "_blank") }) {
  const { recipients } = parseBulkRecipients(text);
  if (!recipients.length) return 0;
  const snapshot = structuredClone(content);
  const tabs = recipients.map(() => {
    try { return openWindow(); } catch { return null; }
  });
  if (tabs.some(tab => !tab)) {
    tabs.forEach(tab => { try { tab?.close(); } catch {} });
    throw new Error("Allow pop-ups and redirects for the Packard Toolkit site and try again. No drafts were created.");
  }
  for (const tab of tabs) {
    try { tab.opener = null; } catch { /* Same handling as Single mode. */ }
  }
  try { await authorize(); }
  catch {
    tabs.forEach(tab => { try { tab.close(); } catch {} });
    throw new Error("Microsoft sign-in could not finish. Allow pop-ups and redirects for the Packard Toolkit site, then try again.");
  }
  const results = await Promise.allSettled(recipients.map(async (recipient, index) => {
    const tab = tabs[index];
    try {
      if (tab.closed) throw new Error("Draft tab was closed.");
      const draft = await createDraft({ ...snapshot, recipient });
      if (tab.closed) throw new Error("Draft tab was closed.");
      tab.location.href = composeUrl(draft);
    } catch (error) {
      try { tab.close(); } catch {}
      throw error;
    }
  }));
  if (results.some(result => result.status === "rejected")) {
    throw new Error("Some Outlook drafts could not be opened. Check the opened tabs and Outlook Drafts for any saved or incomplete drafts before trying again. Nothing was sent.");
  }
  return recipients.length;
}
