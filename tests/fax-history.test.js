import test from "node:test";
import assert from "node:assert/strict";
import { FaxBatch } from "../fax-sender/batch.js";

const pdf = name => new File(["%PDF-1.4"], name, { type: "application/pdf" });
test("recent history reuses tracked results, retains metadata across clear, and bounds newest-first entries", async () => {
  let now = 0;
  let id = 0;
  const batch = new FaxBatch({ pause: async () => {}, submit: async () => ({ messageId: String(++id), status: "Queued" }),
    tracking: { now: () => now, schedule: () => 1, cancel: () => {}, lookup: async messageId => ({ messageId, status: "Sent" }) } });
  assert.deepEqual(batch.recentFaxes, []);
  await batch.addFiles([pdf("first.pdf")]);
  assert.deepEqual(batch.recentFaxes, []);
  await batch.run("+18015551234", "Ready", null, "Recipient");
  assert.equal(batch.recentFaxes[0].state, "Queued");
  now = 10000;
  await batch.tracker.tick();
  assert.equal(batch.recentFaxes[0].status, "Sent");
  assert.equal(batch.recentFaxes[0].recipientName, "Recipient");
  assert.ok(Date.parse(batch.recentFaxes[0].attemptedAt));
  assert.equal(batch.recentFaxes[0].file, undefined);
  batch.clear();
  assert.equal(batch.recentFaxes[0].state, "Delivered");
  await batch.addFiles(Array.from({length: 12}, (_, i) => pdf(`${i}.pdf`)));
  await batch.run("+18015559999");
  assert.equal(batch.recentFaxes.length, 10);
  assert.deepEqual(batch.recentFaxes.map(entry => entry.messageId), Array.from({length: 10}, (_, i) => String(13 - i)));
  batch.clear();
  assert.equal(batch.recentFaxes[0].state, "Status Unknown");
  assert.equal(batch.recentFaxes[0].status, "Queued");
  assert.equal(batch.recentFaxes[0].faxNumber, "+18015559999");
  assert.equal(batch.recentFaxes[0].recipientName, "");
  assert.equal(batch.tracker.pending.size, 0);
  assert.deepEqual(new FaxBatch().recentFaxes, []);
});

test("retry preserves distinct attempts and unknown submission never becomes sent or retryable", async () => {
  let attempt = 0;
  const batch = new FaxBatch({ submit: async () => ({ messageId: String(++attempt), status: attempt === 1 ? "SendingFailed" : "Sent" }) });
  await batch.addFiles([pdf("retry.pdf")]);
  await batch.run("+18015551234");
  await batch.run("+18015551234", "Failed");
  assert.deepEqual(batch.recentFaxes.map(entry => [entry.messageId, entry.status]), [["2", "Sent"], ["1", "SendingFailed"]]);
  batch.clear();
  assert.equal(batch.recentFaxes.length, 2);
  batch.submit = async () => { throw new Error("Unconfirmed"); };
  await batch.addFiles([pdf("unknown.pdf")]);
  await batch.run("+18015551234");
  assert.equal(batch.recentFaxes[0].state, "Status Unknown");
  assert.equal(batch.recentFaxes[0].messageId, null);
  assert.equal(batch.documents[0].retryable, false);
});
