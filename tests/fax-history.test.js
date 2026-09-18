import test from "node:test";
import assert from "node:assert/strict";
import { FaxBatch } from "../fax-sender/batch.js";
import { FAX_HISTORY_KEY, loadFaxHistory, saveFaxHistory } from "../fax-sender/history.js";

const pdf = name => new File(["%PDF-1.4"], name, { type: "application/pdf" });
test("history persists only bounded operational metadata and restores without retrying or restoring SSN", async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const batch = new FaxBatch({ storage, pause: async () => {}, submit: async () => ({ messageId: "42", status: "Queued" }), tracking: { schedule: () => 1, cancel: () => {} } });
  await batch.addFiles([pdf("Form.pdf")]);
  batch.lastFourSsn = "9876";
  await batch.run("+18015551234");
  const doc = batch.documents[0];
  doc.receiptFilename = "Fax Receipt - Form 9876.pdf";
  doc.transmissionDetails = { downloadUrl: "https://private-media", token: "secret-token" };
  batch.onChange();
  const saved = values.get(FAX_HISTORY_KEY);
  assert.doesNotMatch(saved, /9876|private-media|secret-token|%PDF|receiptFilename|transmissionDetails|lastFour/);
  const restored = new FaxBatch({ storage });
  assert.equal(restored.lastFourSsn, "");
  assert.deepEqual(restored.documents, []);
  assert.equal(restored.recentFaxes[0].state, "Status Unknown");
  assert.equal(restored.recentFaxes[0].messageId, "42");
  assert.equal(restored.tracker.pending.size, 0);
  saveFaxHistory(storage, Array(15).fill(batch.recentFaxes[0]));
  assert.equal(loadFaxHistory(storage).length, 10);
  restored.clear();
  assert.deepEqual(restored.recentFaxes, []);
  assert.deepEqual(new FaxBatch({ storage }).recentFaxes, []);
  assert.equal(values.get(FAX_HISTORY_KEY), "[]");
  for (const old of ["null", "{}", '[{"filename":"old.pdf"}]']) {
    values.set(FAX_HISTORY_KEY, old);
    assert.deepEqual(loadFaxHistory(storage), []);
  }
  values.set(FAX_HISTORY_KEY, "malformed");
  assert.deepEqual(loadFaxHistory(storage), []);
  const unavailable = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.deepEqual(loadFaxHistory(unavailable), []);
  assert.equal(saveFaxHistory(unavailable, []), false);
  batch.tracker.clear();
});
test("recent history reuses tracked results, clears history explicitly, and bounds newest-first entries", async () => {
  let now = 0;
  let id = 0;
  const batch = new FaxBatch({ pause: async () => {}, submit: async () => ({ messageId: String(++id), status: "Queued" }),
    tracking: { now: () => now, schedule: () => 1, cancel: () => {}, lookup: async messageId => ({ messageId, status: "Sent" }) } });
  assert.deepEqual(batch.recentFaxes, []);
  await batch.addFiles([pdf("first.pdf")]);
  assert.deepEqual(batch.recentFaxes, []);
    batch.lastFourSsn = "2134"; await batch.run("+18015551234", "Ready", null, "Recipient");
  assert.equal(batch.recentFaxes[0].state, "Queued");
  now = 10000;
  await batch.tracker.tick();
  assert.equal(batch.recentFaxes[0].status, "Sent");
  assert.equal(batch.recentFaxes[0].recipientName, "Recipient");
  assert.ok(Date.parse(batch.recentFaxes[0].attemptedAt));
  assert.equal(batch.recentFaxes[0].file, undefined);
  batch.clear();
  assert.deepEqual(batch.recentFaxes, []);
  await batch.addFiles(Array.from({length: 12}, (_, i) => pdf(`${i}.pdf`)));
    batch.lastFourSsn = "2134"; await batch.run("+18015559999");
  assert.equal(batch.recentFaxes.length, 10);
  assert.deepEqual(batch.recentFaxes.map(entry => entry.messageId), Array.from({length: 10}, (_, i) => String(13 - i)));
  assert.equal(batch.recentFaxes[0].faxNumber, "+18015559999");
  assert.equal(batch.recentFaxes[0].recipientName, "");
  batch.clear();
  assert.deepEqual(batch.recentFaxes, []);
  assert.equal(batch.tracker.pending.size, 0);
  assert.deepEqual(new FaxBatch().recentFaxes, []);
});

test("retry preserves distinct attempts and unknown submission never becomes sent or retryable", async () => {
  let attempt = 0;
  const batch = new FaxBatch({ submit: async () => ({ messageId: String(++attempt), status: attempt === 1 ? "SendingFailed" : "Sent" }) });
  await batch.addFiles([pdf("retry.pdf")]);
    batch.lastFourSsn = "2134"; await batch.run("+18015551234");
  await batch.run("+18015551234", "Failed");
  assert.deepEqual(batch.recentFaxes.map(entry => [entry.messageId, entry.status]), [["2", "Sent"], ["1", "SendingFailed"]]);
  batch.clear();
  assert.equal(batch.recentFaxes.length, 0);
  batch.submit = async () => { throw new Error("Unconfirmed"); };
  await batch.addFiles([pdf("unknown.pdf")]);
    batch.lastFourSsn = "2134"; await batch.run("+18015551234");
  assert.equal(batch.recentFaxes[0].state, "Status Unknown");
  assert.equal(batch.recentFaxes[0].messageId, null);
  assert.equal(batch.documents[0].retryable, false);
});
