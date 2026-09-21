import test from "node:test";
import assert from "node:assert/strict";
import { FaxBatch } from "../fax-sender/batch.js";
import { FAX_HISTORY_KEY, historyRecords, loadFaxHistory, saveFaxHistory } from "../fax-sender/history.js";

const pdf = name => new File(["%PDF-1.4"], name, { type: "application/pdf" });
test("history persists bounded metadata and Last 4 without restoring input or retrying", async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const batch = new FaxBatch({ storage, pause: async () => {}, submit: async () => ({ messageId: "42", status: "Queued" }), tracking: { schedule: () => 1, cancel: () => {} } });
  await batch.addFiles([pdf("Form.pdf")]);
  batch.lastFourSsn = "9876";
  await batch.run("+18015551234");
  const doc = batch.documents[0];
  doc.receiptFilename = "Fax Receipt - Form 9876.pdf";
  doc.transmissionDetails = { downloadUrl: "https://private-media", token: "secret-token" };
  doc.ssn = "123-45-6789";
  doc.accessToken = "secret-token";
  batch.onChange();
  const saved = values.get(FAX_HISTORY_KEY);
  assert.doesNotMatch(saved, /123-45-6789|private-media|secret-token|%PDF|receiptFilename|transmissionDetails/);
  assert.equal(JSON.parse(saved)[0].lastFourSsn, "9876");
  const restored = new FaxBatch({ storage });
  assert.equal(restored.lastFourSsn, "");
  assert.deepEqual(restored.documents, []);
  assert.equal(restored.recentFaxes[0].state, "Status Unknown");
  assert.equal(restored.recentFaxes[0].messageId, "42");
  assert.equal(restored.recentFaxes[0].lastFourSsn, "9876");
  for (const lastFourSsn of [undefined, "123456789", "123-45-6789", "123", "12345", "21A4", 1234]) {
    const sanitized = historyRecords([{ ...restored.recentFaxes[0], lastFourSsn }]);
    assert.equal(sanitized[0].lastFourSsn, "", "Old/invalid Last 4 is omitted, never invented or truncated");
    assert.equal(sanitized[0].filename, "Form.pdf");
  }
  assert.equal(restored.tracker.pending.size, 0);
  const restoredHistory = structuredClone(restored.recentFaxes);
  restored.clear();
  assert.deepEqual(restored.recentFaxes, restoredHistory);
  assert.deepEqual(new FaxBatch({ storage }).recentFaxes, restoredHistory);
  assert.equal(values.get(FAX_HISTORY_KEY), saved);
  saveFaxHistory(storage, Array(25).fill(batch.recentFaxes[0]));
  assert.equal(loadFaxHistory(storage).length, 20);
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

test("each queue and retry retains its own Last 4 snapshot", async () => {
  let id = 0;
  const batch = new FaxBatch({ storage: null, pause: async () => { batch.lastFourSsn = "9999"; },
    submit: async () => ({ messageId: String(++id), status: "SendingFailed" }) });
  await batch.addFiles([pdf("one.pdf"), pdf("two.pdf")]);
  batch.lastFourSsn = "0007";
  await batch.run("+18015551234");
  assert.deepEqual(batch.recentFaxes.map(entry => entry.lastFourSsn), ["0007", "0007"]);
  batch.lastFourSsn = "2134";
  await batch.run("+18015551234", "Failed", batch.documents[0].id);
  assert.deepEqual(batch.recentFaxes.map(entry => entry.lastFourSsn), ["2134", "0007", "0007"]);
});
test("recent history reuses tracked results, survives reset, and bounds newest-first entries", async () => {
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
  const beforeClear = structuredClone(batch.recentFaxes);
  batch.clear();
  assert.deepEqual(batch.recentFaxes, beforeClear);
  await batch.addFiles(Array.from({length: 21}, (_, i) => pdf(`${i}.pdf`)));
    batch.lastFourSsn = "2134"; await batch.run("+18015559999");
  assert.equal(batch.recentFaxes.length, 20);
  assert.deepEqual(batch.recentFaxes.map(entry => entry.messageId), Array.from({length: 20}, (_, i) => String(22 - i)));
  assert.equal(batch.recentFaxes[0].faxNumber, "+18015559999");
  assert.equal(batch.recentFaxes[0].recipientName, "");
  const completedHistory = structuredClone(batch.recentFaxes);
  batch.clear();
  assert.deepEqual(batch.recentFaxes, completedHistory);
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
  assert.equal(batch.recentFaxes.length, 2);
  batch.submit = async () => { throw new Error("Unconfirmed"); };
  await batch.addFiles([pdf("unknown.pdf")]);
    batch.lastFourSsn = "2134"; await batch.run("+18015551234");
  assert.equal(batch.recentFaxes[0].state, "Status Unknown");
  assert.equal(batch.recentFaxes[0].messageId, null);
  assert.equal(batch.documents[0].retryable, false);
});


test("batch reset preserves exact stored records; entry 21 evicts oldest across resets and reloads", async () => {
  const values = new Map(); let writes = 0, sends = 0;
  const storage = {getItem:key=>values.get(key),setItem:(key,value)=>{writes++;values.set(key,value);},removeItem:()=>assert.fail("Reset must never remove history")};
  const options = {storage,pause:async()=>{},submit:async()=>({messageId:String(++sends),status:"Sent"})};
  const batch = new FaxBatch(options);
  for(let index=0;index<20;index++) {
    batch.lastFourSsn="0007";batch.coverPageText="private comment";batch.includeCoverSheet=false;
    await batch.addFiles([pdf(index+".pdf")]);await batch.run("+18015551234","Ready",null,"Existing Contact");
    const before=structuredClone(batch.recentFaxes), saved=values.get(FAX_HISTORY_KEY), previousWrites=writes;
    batch.clear();
    assert.deepEqual(batch.recentFaxes,before);
    assert.equal(values.get(FAX_HISTORY_KEY),saved);assert.equal(writes,previousWrites);
    assert.equal(batch.destination,"");assert.equal(batch.recipientName,"");assert.equal(batch.lastFourSsn,"");
    assert.equal(batch.coverPageText,"");assert.equal(batch.includeCoverSheet,true);assert.equal(batch.coverSettings,null);
    assert.deepEqual(batch.documents,[]);assert.equal(batch.progress,null);assert.equal(batch.running,false);assert.equal(batch.tracker.pending.size,0);
  }
  assert.deepEqual(batch.recentFaxes.map(row=>row.messageId),Array.from({length:20},(_,i)=>String(20-i)));
  const reloaded=new FaxBatch(options);
  assert.deepEqual(reloaded.recentFaxes.map(row=>row.messageId),batch.recentFaxes.map(row=>row.messageId));
  reloaded.lastFourSsn="0099";await reloaded.addFiles([pdf("21.pdf")]);await reloaded.run("+18015559999");
  assert.deepEqual(reloaded.recentFaxes.map(row=>row.messageId),Array.from({length:20},(_,i)=>String(21-i)));
  assert.equal(new Set(reloaded.recentFaxes.map(row=>row.sequence)).size,20);
  reloaded.clear();
  const final=new FaxBatch(options);
  assert.equal(final.recentFaxes.length,20);assert.equal(final.recentFaxes[0].lastFourSsn,"0099");assert.equal(final.recentFaxes.at(-1).messageId,"2");
  assert.doesNotMatch(values.get(FAX_HISTORY_KEY),/private comment|coverPageText|%PDF|accessToken|JWT|mediaUrl/);
});
