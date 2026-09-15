export const INITIAL_DELAY = 10_000;
export const POLL_INTERVAL = 30_000;
export const TRACKING_TIMEOUT = 15 * 60_000;
const REQUEST_GAP = 5_000;

export function faxState(status) {
  if (status === "Sent") return "Delivered";
  if (status === "SendingFailed") return "Failed";
  if (status === "Queued") return "Queued";
  return "Status Unknown";
}

export async function lookupFax(messageId) {
  const response = await fetch(`/api/fax-status?messageId=${encodeURIComponent(messageId)}`, {
    cache: "no-store", signal: AbortSignal.timeout(25_000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success || data.messageId !== messageId) {
    throw new Error(data?.error || "Status lookup unavailable. Checking will continue within the tracking window.");
  }
  return data;
}

// One lookup at a time across the tab, at least five seconds apart.
export class FaxTracker {
  constructor({ lookup = lookupFax, now = Date.now, schedule = setTimeout, cancel = clearTimeout, onChange = () => {} } = {}) {
    Object.assign(this, { lookup, now, schedule, cancel, onChange });
    this.pending = new Map();
    this.timer = null;
    this.checking = false;
  }

  start(doc) {
    doc.state = faxState(doc.status);
    doc.retryable = doc.status === "SendingFailed";
    if (["Delivered", "Failed"].includes(doc.state)) return;
    doc.tracking = true;
    this.pending.set(doc.id, { doc, messageId: doc.messageId, due: this.now() + INITIAL_DELAY, deadline: this.now() + TRACKING_TIMEOUT });
    this.arm(INITIAL_DELAY);
  }

  arm(delay) {
    if (this.timer !== null || this.checking || !this.pending.size) return;
    this.timer = this.schedule(() => { this.timer = null; return this.tick(); }, delay);
  }

  clear() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    for (const { doc } of this.pending.values()) doc.tracking = false;
    this.pending.clear();
  }

  async tick() {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const [id, entry] of this.pending) {
        if (this.now() >= entry.deadline) {
          entry.doc.state = "Status Unknown";
          entry.doc.error = "Tracking timed out. Check RingCentral before retrying.";
          entry.doc.retryable = false;
          entry.doc.tracking = false;
          this.pending.delete(id);
        }
      }
      const entry = [...this.pending.values()].filter(item => item.due <= this.now()).sort((a, b) => a.due - b.due)[0];
      if (!entry) return;
      const { doc, messageId } = entry;
      try {
        const result = await this.lookup(messageId);
        if (this.pending.get(doc.id) !== entry || doc.messageId !== messageId) return;
        if (result.messageId !== messageId) throw new Error("Status response did not match this fax.");
        doc.status = result.status;
        doc.state = faxState(result.status);
        doc.retryable = result.status === "SendingFailed";
        doc.error = doc.state === "Failed" ? "RingCentral reports SendingFailed. Check RingCentral for the failure details." :
          doc.state === "Status Unknown" ? "Unexpected outbound fax status. Check RingCentral before retrying." : "";
        if (["Delivered", "Failed"].includes(doc.state)) {
          doc.tracking = false;
          this.pending.delete(doc.id);
        }
      } catch (error) {
        if (this.pending.get(doc.id) !== entry) return;
        doc.state = "Status Unknown";
        doc.retryable = false;
        doc.error = `${error instanceof Error ? error.message : "Status lookup failed."} Check RingCentral before retrying.`;
      }
      entry.due = this.now() + POLL_INTERVAL;
    } finally {
      this.checking = false;
      this.onChange();
      this.arm(REQUEST_GAP);
    }
  }
}
