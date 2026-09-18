import test from "node:test";
import assert from "node:assert/strict";
import messageHandler, { safeFaxMessage } from "../api/fax-message.js";
import attachmentHandler from "../api/fax-attachment.js";
import { receiptFilename, validLastFour } from "../fax-sender/message.js";

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; },
    send(data) { this.body = data; return this; }
  };
}

const message = {
  id: 3207964623007,
  type: "Fax",
  direction: "Outbound",
  creationTime: "2026-09-15T00:41:46.000Z",
  lastModifiedTime: "2026-09-15T00:47:31.259Z",
  messageStatus: "Sent",
  availability: "Alive",
  faxPageCount: 13,
  faxResolution: "High",
  to: [{ location: "San Antonio, TX", phoneNumber: "+17262034769", messageStatus: "Sent" }],
  from: { location: "San Antonio, TX", phoneNumber: "+12103408877" },
  attachments: [{ id: 3207964623007, type: "RenderedDocument", contentType: "application/pdf", size: 482183, uri: "https://media.ringcentral.com/private/document" }]
};

test("fax message endpoint returns safe outbound metadata and identifies transmitted document", async t => {
  const original = globalThis.fetch;
  const keys = ["RC_CLIENT_ID", "RC_CLIENT_SECRET", "RC_USER_JWT"];
  const env = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = "dummy-secret"; });
  t.after(() => {
    globalThis.fetch = original;
    keys.forEach((key, i) => { if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i]; });
  });
  globalThis.fetch = async url => {
    if (url.endsWith("/oauth/token")) return Response.json({ access_token: "private-token", expires_in: 1 });
    assert.equal(url, "https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/message-store/3207964623007");
    return Response.json({ ...message, subject: "private", error: "private", access_token: "private-token" });
  };
  const res = response();
  await messageHandler({ method: "GET", url: "/api/fax-message?messageId=3207964623007" }, res);
  assert.equal(res.code, 200);
  assert.equal(res.data.receiptAvailable, false);
  assert.match(res.data.receiptNote, /separate confirmation document/);
  assert.deepEqual(res.data.attachments[0], {
    id: "3207964623007", type: "RenderedDocument", contentType: "application/pdf",
    fileName: "Fax document 3207964623007.pdf", size: 482183, downloadable: true,
    downloadUrl: "/api/fax-attachment?messageId=3207964623007&attachmentId=3207964623007"
  });
  assert.doesNotMatch(JSON.stringify(res.data), /private-token|private/);
});

test("message endpoint rejects non-Fax and inbound records", async t => {
  const original = globalThis.fetch;
  const keys = ["RC_CLIENT_ID", "RC_CLIENT_SECRET", "RC_USER_JWT"];
  const env = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = "dummy-secret"; });
  t.after(() => {
    globalThis.fetch = original;
    keys.forEach((key, i) => { if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i]; });
  });
  let current = { ...message, type: "SMS" };
  globalThis.fetch = async url => url.endsWith("/oauth/token")
    ? Response.json({ access_token: "token", expires_in: 1 })
    : Response.json(current);
  for (const change of [{ type: "SMS" }, { type: "Fax", direction: "Inbound" }]) {
    current = { ...message, ...change };
    const res = response();
    await messageHandler({ method: "GET", url: "/api/fax-message?messageId=3207964623007" }, res);
    assert.equal(res.code, 502);
  }
});

test("attachment download re-verifies message ownership and returns safe PDF headers", async t => {
  const original = globalThis.fetch;
  const keys = ["RC_CLIENT_ID", "RC_CLIENT_SECRET", "RC_USER_JWT"];
  const env = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = "dummy-secret"; });
  t.after(() => {
    globalThis.fetch = original;
    keys.forEach((key, i) => { if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i]; });
  });
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (url.endsWith("/oauth/token")) return Response.json({ access_token: "token", expires_in: 1 });
    if (url.startsWith("https://media.ringcentral.com")) return new Response("%PDF-transmitted", { headers: { "content-type": "application/pdf" } });
    return Response.json(message);
  };
  const res = response();
  await attachmentHandler({ method: "GET", url: "/api/fax-attachment?messageId=3207964623007&attachmentId=3207964623007" }, res);
  assert.equal(res.code, 200);
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(res.headers["Content-Disposition"], /attachment; filename="Fax document 3207964623007\.pdf"/);
  assert.equal(res.body.toString(), "%PDF-transmitted");
  assert.equal(calls >= 2, true);
  const invalid = response();
  await attachmentHandler({ method: "GET", url: "/api/fax-attachment?messageId=3207964623007&attachmentId=999" }, invalid);
  assert.equal(invalid.code, 404);
});

test("safeFaxMessage does not expose RingCentral URLs or private fields", () => {
  const result = safeFaxMessage("1", { ...message, secret: "private", attachments: [{ id: 2, type: "RenderedDocument", contentType: "application/pdf", uri: "https://private" }] });
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.equal(result.attachments[0].downloadUrl, "/api/fax-attachment?messageId=1&attachmentId=2");
});

test("Fax Receipt filenames use each original document name and the batch last four", () => {
  assert.equal(receiptFilename("827.pdf", "2134"), "Fax Receipt - 827 2134.pdf");
  assert.equal(receiptFilename("DIB DR.pdf", "1234"), "Fax Receipt - DIB DR 1234.pdf");
  assert.equal(receiptFilename("Form.PDF", "0007"), "Fax Receipt - Form 0007.pdf");
  assert.equal(receiptFilename("SSA-827 FINAL.pdf", "9876"), "Fax Receipt - SSA-827 FINAL 9876.pdf");
  assert.equal(receiptFilename("one.pdf", "2134"), "Fax Receipt - one 2134.pdf");
  assert.equal(receiptFilename("two.PDF", "2134"), "Fax Receipt - two 2134.pdf");
  assert.equal(receiptFilename("bad:/name?.pdf", "2134"), "Fax Receipt - bad__name_ 2134.pdf");
  assert.equal(receiptFilename(undefined, "2134"), "Fax Receipt - Document 2134.pdf");
  assert.equal(receiptFilename("SSA-827.pdf"), "Fax Receipt - SSA-827.pdf");
  assert.equal(receiptFilename("bad:/name?.pdf", ""), "Fax Receipt - bad__name_.pdf");
  assert.equal(receiptFilename("SSA-827.pdf", "123456789"), "Fax Receipt - SSA-827.pdf");
  assert.equal(validLastFour("2134"), true);
  assert.equal(validLastFour("0007"), true);
  for (const value of ["", "123", "12345", "21A4", "12-34"]) assert.equal(validLastFour(value), false);
});
