import test from "node:test";
import assert from "node:assert/strict";
import { FaxTracker, TRACKING_TIMEOUT, faxState, lookupFax } from "../fax-sender/tracking.js";
import { FaxBatch } from "../fax-sender/batch.js";

function harness(lookup) {
  let time = 0;
  const tracker = new FaxTracker({ lookup, now: () => time, schedule: () => 1, cancel: () => {} });
  return { tracker, step: async ms => { time += ms; await tracker.tick(); } };
}
const document = id => ({ id, messageId: String(id), status: "Queued", error: "" });

test("default timers preserve global receiver for initial poll, rearming, and cancellation", async t => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  t.after(() => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; });
  const timers = new Map();
  let next = 0, time = 0, calls = 0;
  globalThis.setTimeout = function (callback, delay) {
    assert.equal(this, globalThis, "Window timer called with wrong receiver");
    timers.set(++next, { callback, delay });
    return next;
  };
  globalThis.clearTimeout = function (timer) {
    assert.equal(this, globalThis, "Window cancellation called with wrong receiver");
    timers.delete(timer);
  };
  const tracker = new FaxTracker({ now: () => time, lookup: async id => {
    calls++; return { messageId: id, status: "Queued" };
  } });
  tracker.start(document(1));
  assert.equal(timers.get(1).delay, 10000);
  time = 10000;
  const first = timers.get(1); timers.delete(1);
  await first.callback();
  assert.equal(calls, 1);
  assert.equal(timers.get(2).delay, 5000);
  tracker.clear();
  assert.equal(timers.size, 0);
});

test("status lookup uses the expected GET path and exposes only safe errors", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async function (url, options) {
    assert.equal(this, globalThis);
    assert.equal(url, "/api/fax-status?messageId=3207964623007");
    assert.equal(options.method, undefined); // fetch defaults to GET.
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ success: true, messageId: "3207964623007", status: "Queued" });
  };
  assert.equal((await lookupFax("3207964623007")).status, "Queued");
  globalThis.fetch = async () => { throw new Error("sensitive browser exception"); };
  await assert.rejects(lookupFax("123"), error => /Could not reach/.test(error.message) && !/sensitive/.test(error.message));
  globalThis.fetch = async () => { throw new DOMException("sensitive", "TimeoutError"); };
  await assert.rejects(lookupFax("123"), /Status lookup timed out/);
  globalThis.fetch = async () => Response.json({ error: "sensitive payload" }, { status: 403 });
  await assert.rejects(lookupFax("123"), error => /ReadMessages/.test(error.message) && !/sensitive/.test(error.message));
});

test("Queued -> Sent stops polling; a confirmed failure does not affect another fax", async () => {
  const calls = [];
  const { tracker, step } = harness(async id => {
    calls.push(id);
    return { messageId: id, status: id === "1" ? "SendingFailed" : "Sent" };
  });
  const first = document(1), second = document(2);
  tracker.start(first); tracker.start(second);
  await step(9000);
  assert.equal(calls.length, 0);
  await step(1000);
  assert.equal(first.state, "Failed"); assert.equal(first.retryable, true);
  await step(5000);
  assert.equal(second.state, "Delivered"); assert.equal(second.retryable, false);
  await step(60000);
  assert.deepEqual(calls, ["1", "2"]);
  assert.equal(tracker.pending.size, 0);
});

test("temporary endpoint error -> later success; polling failure never enables retry", async () => {
  let calls = 0;
  const { tracker, step } = harness(async id => {
    if (++calls === 1) throw new Error("Temporary error");
    return { messageId: id, status: "Sent" };
  });
  const doc = document(1); tracker.start(doc);
  await step(10000);
  assert.equal(doc.state, "Status Unknown"); assert.equal(doc.retryable, false);
  assert.equal(doc.status, "Queued");
  await step(29000); assert.equal(calls, 1);
  await step(1000); assert.equal(doc.state, "Delivered"); assert.equal(doc.error, "");
});

test("polling timeout is unknown, never failed; unexpected SMS states are not fax outcomes", async () => {
  let calls = 0;
  const { tracker, step } = harness(async id => { calls++; return { messageId: id, status: "Queued" }; });
  const doc = document(1); tracker.start(doc);
  await step(10000);
  await step(TRACKING_TIMEOUT);
  assert.equal(doc.state, "Status Unknown"); assert.equal(doc.retryable, false);
  assert.equal(doc.messageId, "1"); assert.equal(doc.tracking, false);
  await step(60000); assert.equal(calls, 1);
  for (const status of ["Delivered", "DeliveryFailed", "Received", "Sending", "new-value"]) assert.equal(faxState(status), "Status Unknown");
});

test("clear ignores an in-flight lookup response", async () => {
  let resolve;
  const { tracker, step } = harness(() => new Promise(done => { resolve = done; }));
  const doc = document(1); tracker.start(doc);
  const checking = step(10000);
  tracker.clear();
  resolve({ messageId: "1", status: "Sent" });
  await checking;
  assert.equal(doc.state, "Queued"); assert.equal(tracker.pending.size, 0);
});

test("confirmed failed fax retries with a new ID and preserves old ID; delivered and unknown cannot retry", async () => {
  let time = 0, calls = 0;
  const batch = new FaxBatch({
    pause: async () => {},
    submit: async file => {
      calls++;
      if (file.name === "unknown.pdf") throw new Error("Request timed out");
      return { messageId: String(calls), status: "Queued" };
    },
    tracking: { now: () => time, schedule: () => 1, cancel: () => {},
      lookup: async id => ({ messageId: id, status: id === "1" ? "SendingFailed" : "Sent" }) }
  });
  await batch.addFiles(["failed.pdf", "delivered.pdf", "unknown.pdf"].map(name => new File(["%PDF-1.4"], name, { type: "application/pdf" })));
  await batch.run("+18015551234");
  time = 10000; await batch.tracker.tick();
  time = 15000; await batch.tracker.tick();
  assert.deepEqual(batch.documents.map(doc => doc.state), ["Failed", "Delivered", "Status Unknown"]);
  await batch.run("+18015559999", "Failed");
  assert.equal(calls, 4);
  assert.deepEqual(batch.documents[0].history.map(({ messageId, status }) => ({ messageId, status })), [{ messageId: "1", status: "SendingFailed" }]);
  assert.equal(batch.documents[0].messageId, "4");
  assert.equal(batch.documents[1].messageId, "2");
  await batch.run("+18015551234", "Failed");
  await batch.run("+18015551234");
  assert.equal(calls, 4);
  time = 30000; await batch.tracker.tick();
  assert.equal(batch.documents[0].state, "Delivered");
});
