import test from "node:test";
import assert from "node:assert/strict";
import { FaxBatch, submitDocument, validFaxNumber } from "../fax-sender/batch.js";

const pdf = (name, content = "%PDF-1.4\n%%EOF", options = {}) =>
  new File([content], name, { type: "application/pdf", lastModified: 1, ...options });
const noPause = async () => {};

test("validates selections, adds files, skips duplicates, and removes/clears ready rows", async () => {
  const batch = new FaxBatch({ tracking: { schedule: () => 1, cancel: () => {} } });
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
  const batch = new FaxBatch({ tracking: { schedule: () => 1, cancel: () => {} },
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
  batch.lastFourSsn = "2134";
  await batch.run("+1 (801) 555-1234");
  assert.equal(calls.length, 8);
  assert.equal(maxActive, 1);
  assert.equal(gaps, 7);
  assert.ok(calls.every(([, number]) => number === "+18015551234"));
  assert.equal(new Set(batch.documents.map(doc => doc.messageId)).size, 8);
  assert.ok(batch.documents.every(doc => doc.state === "Queued" && doc.status === "Queued"));
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
  const batch = new FaxBatch({ tracking: { schedule: () => 1, cancel: () => {} }, pause: noPause, submit: async (file, number) => {
    calls.push([file.name, number]);
    if (fail && file.name !== "one.pdf") return { messageId: String(calls.length), status: "SendingFailed" };
    return { messageId: String(calls.length), status: "Queued" };
  } });
  await batch.addFiles([pdf("one.pdf"), pdf("two.pdf"), pdf("three.pdf")]);
  batch.lastFourSsn = "2134";
  await batch.run("+18015551234");
  assert.deepEqual(batch.documents.map(doc => doc.state), ["Queued", "Failed", "Failed"]);
  assert.equal(batch.documents[1].retryable, true);
  const firstMessage = batch.documents[0].messageId;
  fail = false;
  await batch.run("+18015559999", "Failed", batch.documents[1].id);
  assert.deepEqual(batch.documents.map(doc => doc.state), ["Queued", "Queued", "Failed"]);
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
  const batch = new FaxBatch({ tracking: { schedule: () => 1, cancel: () => {} }, pause: noPause, submit: async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return { messageId: "123", status: "Queued" };
  } });
  await batch.addFiles([pdf("one.pdf")]);
  batch.lastFourSsn = "2134";
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
  assert.equal(batch.documents[0].state, "Queued");
  batch.clear();
  assert.equal(batch.destination, "");
});

test("Last 4 is required before the queue starts and leading zeroes are allowed", async () => {
  const calls = [];
  const batch = new FaxBatch({ tracking: { schedule: () => 1, cancel: () => {} }, pause: noPause,
    submit: async (file, number, ...extra) => {
      calls.push({ file: file.name, number, extra });
      return { messageId: String(calls.length), status: "Queued" };
    } });
  await batch.addFiles([pdf("one.pdf"), pdf("two.pdf")]);
  for (const value of ["", "123", "12345", "21A4", "12-34"]) {
    batch.lastFourSsn = value;
    await batch.run("+18015551234");
    assert.equal(calls.length, 0, `invalid Last 4 ${JSON.stringify(value)} submitted a fax`);
    assert.ok(batch.documents.every(doc => doc.state === "Ready"));
  }
  batch.lastFourSsn = "0007";
  await batch.run("+18015551234");
  assert.equal(calls.length, 2);
  for (const call of calls) assert.deepEqual(call.extra, [{includeCoverSheet:true, recipientName:"", coverPageText:""}]);
  assert.ok(calls.every(call => call.number === "+18015551234" && call.extra.length === 1));
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
    assert.deepEqual([...options.body.keys()], ["faxNumber", "file", "includeCoverSheet"]);
    assert.equal(options.body.get("includeCoverSheet"), "true");
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


test("new batches default ON; three PDFs each carry the same cover choice without extra faxes", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const enabled of [true, false]) {
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push(options.body);
      assert.equal(url, "/api/send-fax");
      return Response.json({success:true, messageId:String(requests.length), status:"Queued"});
    };
    const batch = new FaxBatch({storage:null, pause: async () => { batch.includeCoverSheet = !enabled; }, tracking:{schedule:()=>1,cancel:()=>{}}});
    assert.equal(batch.includeCoverSheet, true);
    batch.includeCoverSheet = enabled;
    batch.lastFourSsn = "0007";
    await batch.addFiles([pdf("827.pdf"),pdf("DIB DR.pdf"),pdf("SSA-3368.pdf")]);
    await batch.run("+18015551234", "Ready", null, "Existing Contact");
    assert.equal(requests.length, 3);
    assert.equal(new Set(batch.documents.map(doc=>doc.messageId)).size,3);
    for (const [i, body] of requests.entries()) {
      assert.equal(body.get("includeCoverSheet"), String(enabled));
      assert.equal(body.get("recipientName"), enabled ? "Existing Contact" : null);
      assert.deepEqual([...body.keys()], ["faxNumber","file","includeCoverSheet", ...(enabled ? ["recipientName"] : [])]);
      assert.equal(body.getAll("file").length,1);
      assert.equal(body.get("file").name, batch.documents[i].file.name);
    }
    batch.clear();
    assert.equal(batch.includeCoverSheet, true);
  }
});


test("comment snapshots survive queue edits, later files and retries without persisting", async t => {
  const original = globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
  const stored = new Map();
  const storage = { getItem:key=>stored.get(key), setItem:(key,value)=>stored.set(key,value) };
  const calls=[];
  globalThis.fetch = async (url, options) => {
    assert.equal(url,"/api/send-fax"); calls.push(options.body);
    return Response.json({success:true,messageId:String(calls.length),status:calls.length===1 ? "SendingFailed" : "Queued"});
  };
  const batch = new FaxBatch({storage,pause:async()=>{batch.coverPageText="changed";batch.includeCoverSheet=false;},tracking:{schedule:()=>1,cancel:()=>{}}});
  assert.equal(batch.coverPageText, "");
  batch.coverPageText="  private batch comment  "; batch.lastFourSsn="0007";
  await batch.addFiles([pdf("one.pdf"),pdf("two.pdf"),pdf("three.pdf")]);
  await batch.run("+18015551234");
  assert.equal(calls.length,3);
  await batch.run("+18015551234","Failed");
  await batch.addFiles([pdf("four.pdf")]); await batch.run("+18015551234");
  assert.equal(calls.length,5);
  assert.ok(calls.every(body=>body.get("coverPageText")==="private batch comment" && body.get("includeCoverSheet")==="true" && body.getAll("file").length===1));
  assert.doesNotMatch(JSON.stringify([...stored.values()]), /private batch comment|coverPageText|coverSettings/);
  assert.doesNotMatch(JSON.stringify(batch.recentFaxes), /private batch comment|coverPageText|coverSettings/);
  assert.equal(new FaxBatch({storage}).coverPageText, "");
  batch.clear(); assert.equal(batch.coverPageText,""); assert.equal(batch.includeCoverSheet,true); assert.equal(batch.coverSettings,null);
  batch.includeCoverSheet=false; batch.coverPageText="stale private text"; batch.lastFourSsn="0007";
  await batch.addFiles([pdf("off.pdf")]); await batch.run("+18015551234");
  assert.equal(calls.at(-1).has("coverPageText"),false);
});

test("over-limit comment prevents any batch submission", async () => {
  const errors=[];
  const batch=new FaxBatch({storage:null,submit:()=>assert.fail("Must not send"),onValidationError:message=>errors.push(message)});
  batch.lastFourSsn="0007"; batch.coverPageText="x".repeat(1025);
  await batch.addFiles([pdf("one.pdf")]); await batch.run("+18015551234");
  assert.equal(errors.length,1); assert.equal(batch.destination,""); assert.equal(batch.coverSettings,null);
});
