import test from "node:test";
import assert from "node:assert/strict";
import { BulkEmailBatch, isValidBulkEmail, parseBulkRecipients } from "../welcome-email-sender/bulkEmail.js";
import { createOutlookDraft, sendOutlookEmail } from "../welcome-email-sender/outlookGraph.js";

for (const [name, separator] of [["newlines", "\n"], ["commas", ","], ["semicolons", ";"], ["spaces", " "], ["tabs", "\t"]]) {
  test(`parses ${name}`, () => {
    assert.deepEqual(parseBulkRecipients(`one@example.com${separator}two@example.com`).recipients,
      ["one@example.com", "two@example.com"]);
  });
}

test("mixed formatting, names, mail links, whitespace, duplicate removal and counts", () => {
  const result = parseBulkRecipients('  John Smith <John@example.com>\n[jane@example.com](mailto:jane@example.com); bill@example.com\t\n sarah@example.com, JOHN@EXAMPLE.COM; bad@@example.com  ');
  assert.deepEqual(result, { recipients: ["john@example.com", "jane@example.com", "bill@example.com", "sarah@example.com"],
    found: 6, duplicates: 1, invalid: ["bad@@example.com"] });
  assert.deepEqual(parseBulkRecipients("one@example.com <two@example.com>").recipients, ["one@example.com", "two@example.com"]);
});

test("obviously invalid entries are never silently repaired or queued", () => {
  const invalid = ["bad", "x@", "@example.com", "a@@example.com", "a@example", "a..b@example.com", ".a@example.com", "a.@example.com", "a@-example.com", "a@example..com", "a@example.com/path", "a@example.com?subject=hi", "a".repeat(65) + "@example.com"];
  for (const address of invalid) assert.equal(isValidBulkEmail(address), false, address);
  assert.deepEqual(parseBulkRecipients(invalid.join("\n")).recipients, []);
  assert.ok(isValidBulkEmail("first.last+tag@sub.example.com"));
  assert.equal(parseBulkRecipients("  \n\t,; ").found, 0);
});

const noPause = async () => {};
test("zero valid recipients cannot prepare or send a batch", async () => {
  const batch = new BulkEmailBatch({ recipients: ["bad"], content: {}, prepare: () => assert.fail("must not authenticate"), pause: noPause });
  await batch.run();
  await batch.run({ retry: true });
  assert.equal(batch.sent.size, 0);
});

test("queue is sequential, deduplicated, paced, and continues after a failure", async () => {
  const calls = [], progress = [], delays = [];
  let active = 0;
  const batch = new BulkEmailBatch({
    recipients: ["a@example.com", "A@example.com", "bad", "b@example.com", "c@example.com"], content: {},
    pause: async ms => delays.push(ms),
    prepare: async () => async recipient => {
      assert.equal(++active, 1);
      calls.push(recipient);
      await Promise.resolve();
      active--;
      if (recipient === "b@example.com") throw new Error("Simulated failure");
    },
  });
  await batch.run({ onProgress: value => progress.push(value) });
  assert.deepEqual(calls, ["a@example.com", "b@example.com", "c@example.com"]);
  assert.deepEqual([...batch.sent], ["a@example.com", "c@example.com"]);
  assert.deepEqual(batch.failed, ["b@example.com"]);
  assert.deepEqual(progress, [{ current: 1, total: 3 }, { current: 2, total: 3 }, { current: 3, total: 3 }]);
  assert.deepEqual(delays, [500, 500]);
});

test("retry sends only failures with original content and preparation; successes are never resent", async () => {
  const content = { subject: "Original", body: "Same signature", managerName: "Amanda Zuscar", language: "english" };
  const calls = [];
  let preparations = 0, fail = true;
  const batch = new BulkEmailBatch({ recipients: ["a@example.com", "b@example.com"], content, pause: noPause,
    prepare: async snapshot => {
      preparations++;
      assert.equal(snapshot.subject, "Original");
      return async recipient => {
        calls.push(recipient);
        if (fail && recipient === "b@example.com") throw new Error("Simulated failure");
      };
    },
  });
  content.subject = "Edited";
  await batch.run();
  fail = false;
  await batch.run({ retry: true });
  await batch.run({ retry: true });
  await batch.run();
  assert.deepEqual(calls, ["a@example.com", "b@example.com", "b@example.com"]);
  assert.equal(preparations, 1);
  assert.equal(batch.sent.size, 2);
  assert.deepEqual(batch.failed, []);
});

test("another run cannot start during preparation or sending", async () => {
  let release, calls = 0;
  const ready = new Promise(resolve => { release = resolve; });
  const batch = new BulkEmailBatch({ recipients: ["a@example.com"], content: {}, pause: noPause,
    prepare: async () => { await ready; return async () => { calls++; }; },
  });
  const first = batch.run();
  await batch.run();
  await batch.run({ retry: true });
  release();
  await first;
  assert.equal(calls, 1);
});

test("preparation failure sends nothing and releases the queue lock", async () => {
  const batch = new BulkEmailBatch({ recipients: ["a@example.com"], content: {}, prepare: async () => { throw new Error("Sign-in failed"); } });
  await assert.rejects(batch.run(), /Sign-in failed/);
  assert.equal(batch.running, false);
  assert.equal(batch.started, false);
  assert.equal(batch.sent.size, 0);
});

test("Graph creates separate private messages with identical content and PDFs", async t => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return new Response(url.endsWith("/messages") ? JSON.stringify({ id: `draft-${requests.length}`, webLink: "https://outlook.office.com/" }) : null,
      { status: url.endsWith("/messages") ? 201 : 202 });
  });
  const prepared = { accessToken: "test", attachments: [{ name: "packet.pdf", buffer: new TextEncoder().encode("%PDF-1.4").buffer }] };
  for (const recipient of ["a@example.com", "b@example.com"]) {
    await sendOutlookEmail({ recipient, subject: "Welcome", body: "Signature", managerName: "Amanda Zuscar" }, prepared, {});
  }
  const messages = requests.filter(request => request.url.endsWith("/messages"));
  assert.equal(messages.length, 2);
  for (const [index, message] of messages.entries()) {
    assert.deepEqual(message.body, { subject: "Welcome", body: { contentType: "Text", content: "Signature" },
      toRecipients: [{ emailAddress: { address: ["a@example.com", "b@example.com"][index] } }] });
  }
  const attachments = requests.filter(request => request.url.endsWith("/attachments"));
  assert.equal(attachments.length, 2);
  assert.deepEqual(attachments[0].body, attachments[1].body);
  assert.equal(requests.filter(request => request.url.endsWith("/send")).length, 2);
});

test("Graph rejects lists and invalid recipients before any request", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("must not make a Graph request"));
  for (const recipient of ["bad", "a@example.com;b@example.com", "a@example.com,b@example.com"]) {
    await assert.rejects(sendOutlookEmail({ recipient }, { accessToken: "test", attachments: [] }, {}), /Invalid/);
  }
});

test("retry reuses the failed draft instead of creating a duplicate message", async t => {
  const urls = [];
  let fail = true;
  t.mock.method(globalThis, "fetch", async url => {
    urls.push(url);
    if (url.endsWith("/messages")) return Response.json({ id: "draft-1" }, { status: 201 });
    if (fail) return Response.json({ error: { message: "Try again" } }, { status: 429 });
    return new Response(null, { status: 202 });
  });
  const content = { recipient: "a@example.com", subject: "Welcome", body: "Signature" };
  const prepared = { accessToken: "test", attachments: [] }, delivery = {};
  await assert.rejects(sendOutlookEmail(content, prepared, delivery), /Try again/);
  fail = false;
  await sendOutlookEmail(content, prepared, delivery);
  assert.deepEqual(urls, ["https://graph.microsoft.com/v1.0/me/messages", "https://graph.microsoft.com/v1.0/me/messages/draft-1/send", "https://graph.microsoft.com/v1.0/me/messages/draft-1/send"]);
});

test("existing draft creation still creates only a draft for its single recipient", async t => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return Response.json({ id: "single", webLink: "https://outlook.office.com/" }, { status: 201 });
  });
  await createOutlookDraft({ recipient: "single@example.com", subject: "Subject", body: "Body" }, { accessToken: "test", attachments: [] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://graph.microsoft.com/v1.0/me/messages");
  assert.deepEqual(requests[0].body.toRecipients, [{ emailAddress: { address: "single@example.com" } }]);
});
