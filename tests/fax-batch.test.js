import test from "node:test";
import assert from "node:assert/strict";
import { FaxBatch, submitDocument, validFaxNumber } from "../fax-sender/batch.js";

const pdf = (name, content = "%PDF-1.4\n%%EOF", options = {}) =>
  new File([content], name, { type: "application/pdf", lastModified: 1, ...options });
const noPause = async () => {};

test("validates selections, adds files, skips duplicates, and removes/clears ready rows", async () => {
  const batch = new FaxBatch();
  const errors = await batch.addFiles([
    pdf("one.pdf"), pdf("one.pdf"), pdf("text.txt"), pdf("empty.pdf", ""),
    pdf("fake.pdf", "not a pdf"), pdf("large.pdf", "%PDF-" + "a".repeat(4_000_000)),
    pdf("wrong.pdf", "%PDF-", { type: "image/png" })
  ]);
  assert.equal(errors.length, 6);
  assert.equal(batch.documents.length, 1);
  await batch.addFiles([pdf("two.PDF")]);
  assert.equal(batch.documents.length, 2);
  batch.remove(batch.documents[0].id);
  assert.equal(batch.documents[0].file.name, "two.PDF");
  batch.clear();
  assert.equal(batch.documents.length, 0);
  assert.equal(batch.destination, "");
  assert.ok(validFaxNumber("+1 (801) 555-1234"));
  assert.equal(validFaxNumber("8015551234"), false);
  assert.equal(validFaxNumber(""), false);
});

test("eight PDFs produce eight sequential requests with distinct results", async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const progress = [];
  let gaps = 0;
  const batch = new FaxBatch({
    pause: async () => { gaps++; },
    onChange: () => {
      if (batch.progress) progress.push({ ...batch.progress });
    },
    submit: async (file, number) => {
      maxActive = Math.max(maxActive, ++active);
      calls.push([file.name, number]);
      await Promise.resolve();
      active--;
      return { messageId: String(calls.length), status: "Queued" };
    }
  });
  await batch.addFiles(Array.from({ length: 8 }, (_, i) => pdf(`${i}.pdf`)));
  await batch.run("+1 (801) 555-1234");
  assert.equal(calls.length, 8);
  assert.equal(maxActive, 1);
  assert.equal(gaps, 7);
  assert.ok(calls.every(([, number]) => number === "+18015551234"));
  assert.equal(new Set(batch.documents.map(doc => doc.messageId)).size, 8);
  assert.ok(batch.documents.every(doc => doc.state === "Submitted" && doc.status === "Queued"));
  assert.ok(progress.some(item => item.current === 8 && item.total === 8));
  await batch.run("+18015551234");
  await batch.run("+18015551234", "Failed");
  batch.remove(batch.documents[0].id);
  assert.equal(calls.length, 8);
  assert.equal(batch.documents.length, 8);
});

test("failure does not stop queue; individual and batch retries never resend submitted rows", async () => {
  const calls = [];
  let fail = true;
  const batch = new FaxBatch({ pause: noPause, submit: async (file, number) => {
    calls.push([file.name, number]);
    if (fail && file.name !== "one.pdf") throw new Error("Rate limit reached. Wait before retrying.");
    return { messageId: String(calls.length), status: "Queued" };
  } });
  await batch.addFiles([pdf("one.pdf"), pdf("two.pdf"), pdf("three.pdf")]);
  await batch.run("+18015551234");
  assert.deepEqual(batch.documents.map(doc => doc.state), ["Submitted", "Failed", "Failed"]);
  assert.match(batch.documents[1].error, /Rate limit/);
  const firstMessage = batch.documents[0].messageId;
  fail = false;
  await batch.run("+18015559999", "Failed", batch.documents[1].id);
  assert.deepEqual(batch.documents.map(doc => doc.state), ["Submitted", "Submitted", "Failed"]);
  await batch.run("+18015559999", "Failed");
  assert.deepEqual(calls.map(([name]) => name), ["one.pdf", "two.pdf", "three.pdf", "two.pdf", "three.pdf"]);
  assert.ok(calls.every(([, number]) => number === "+18015551234"));
  assert.equal(batch.documents[0].messageId, firstMessage);
  assert.ok(batch.documents.every(doc => !doc.error));
  await batch.addFiles([pdf("four.pdf")]);
  await batch.run("+18015559999");
  assert.equal(calls.at(-1)[0], "four.pdf");
  assert.equal(calls.length, 6);
});

test("invalid destination, double click, and mutations during sending cannot start extra work", async () => {
  let release;
  let calls = 0;
  const batch = new FaxBatch({ pause: noPause, submit: async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return { messageId: "123", status: "Queued" };
  } });
  await batch.addFiles([pdf("one.pdf")]);
  await batch.run("");
  assert.equal(calls, 0);
  const running = batch.run("+18015551234");
  assert.equal(batch.running, true);
  await batch.run("+18015551234");
  await batch.run("+18015551234", "Failed");
  batch.remove(batch.documents[0].id);
  batch.clear();
  await batch.addFiles([pdf("two.pdf")]);
  assert.equal(batch.documents.length, 1);
  assert.equal(calls, 1);
  release();
  await running;
  assert.equal(batch.running, false);
  assert.equal(batch.documents[0].state, "Submitted");
  batch.clear();
  assert.equal(batch.destination, "");
});

test("client transport sends one multipart PDF per request and treats ambiguous failures carefully", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "/api/send-fax");
    assert.equal(options.method, "POST");
    assert.equal(options.headers, undefined);
    assert.deepEqual([...options.body.keys()], ["faxNumber", "file"]);
    assert.equal(options.body.get("file").name, "one.pdf");
    assert.equal(options.body.get("faxNumber"), "+18015551234");
    return Response.json({ success: true, messageId: "456", status: "Queued" });
  };
  assert.deepEqual(await submitDocument(pdf("one.pdf"), "+18015551234"), { messageId: "456", status: "Queued" });
  assert.equal(calls, 1);
  globalThis.fetch = async () => { throw new TypeError("network failure"); };
  await assert.rejects(submitDocument(pdf("one.pdf"), "+18015551234"), /Check RingCentral/);
  globalThis.fetch = async () => new Response("Bad gateway", { status: 502 });
  await assert.rejects(submitDocument(pdf("one.pdf"), "+18015551234"), /Check RingCentral/);
  globalThis.fetch = async () => Response.json({ success: true });
  await assert.rejects(submitDocument(pdf("one.pdf"), "+18015551234"), /Check RingCentral/);
  globalThis.fetch = async () => Response.json({ success: false, error: "Rate limit reached." }, { status: 429 });
  await assert.rejects(submitDocument(pdf("one.pdf"), "+18015551234"), /Rate limit/);
});
