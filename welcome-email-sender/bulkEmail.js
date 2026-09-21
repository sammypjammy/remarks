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

export class BulkEmailBatch {
  constructor({ recipients, content, prepare, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.recipients = parseBulkRecipients(recipients.join("\n")).recipients;
    this.content = structuredClone(content);
    this.prepare = prepare;
    this.pause = pause;
    this.created = new Map();
    this.failed = [];
    this.running = false;
    this.started = false;
  }

  async run({ retry = false, onProgress = () => {} } = {}) {
    if (this.running) return;
    const queue = retry ? [...this.failed] : this.started ? [] : [...this.recipients];
    if (!queue.length) return;
    this.running = true;
    try {
      // Load the exact PDFs once; retries retain these bytes and this content.
      this.createDraft ||= await this.prepare(this.content);
      this.started = true;
      this.failed = [];
      for (const [index, recipient] of queue.entries()) {
        onProgress({ current: index + 1, total: queue.length });
        try {
          const draft = await this.createDraft(recipient);
          this.created.set(recipient, draft);
        } catch (error) {
          console.error("Outlook bulk email failed:", error);
          this.failed.push(recipient);
        }
        if (index < queue.length - 1) await this.pause(500);
      }
    } finally {
      this.running = false;
    }
  }
}
