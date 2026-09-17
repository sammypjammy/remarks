import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/fax-status.js";

async function request(query = "messageId=123", method = "GET") {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ method, url: `/api/fax-status?${query}` }, res);
  return res;
}

test("status API validates IDs, verifies outbound fax, and returns only safe fields", async t => {
  const original = globalThis.fetch;
  const keys = ["RC_CLIENT_ID", "RC_CLIENT_SECRET", "RC_USER_JWT"];
  const env = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = "dummy-secret"; });
  t.after(() => {
    globalThis.fetch = original;
    keys.forEach((key, i) => { if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i]; });
  });
  globalThis.fetch = () => { throw new Error("Must not fetch"); };
  for (const query of ["", "messageId=../123", "messageId=1&messageId=2", "messageId=abc", "messageId=0", `messageId=${"1".repeat(31)}`]) assert.equal((await request(query)).code, 400);
  assert.equal((await request("messageId=123", "POST")).code, 405);
  let status = "Queued", type = "Fax", direction = "Outbound", upstream = 200;
  let authCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/oauth/token")) {
      authCalls++;
      assert.equal(options.body.get("assertion"), "dummy-secret");
      return Response.json({ access_token: "private-token", expires_in: 3600 });
    }
    assert.equal(url, "https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/message-store/123");
    assert.equal(options.headers.Authorization, "Bearer private-token");
    return Response.json({ id: 123, type, direction, messageStatus: status, subject: "private-document", access_token: "private-token", error: "private-token" }, { status: upstream });
  };
  for (const value of ["Queued", "Sent", "SendingFailed", "Delivered", "DeliveryFailed", "Received"]) {
    status = value;
    const res = await request();
    assert.equal(res.code, 200);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.deepEqual(res.data, { success: true, messageId: "123", status, terminal: ["Sent", "SendingFailed"].includes(status) });
  }
  assert.ok(authCalls <= 1, "JWT authentication is shared through the server-side token cache");
  type = "SMS"; assert.equal((await request()).code, 502);
  type = "Fax"; direction = "Inbound"; assert.equal((await request()).code, 502);
  direction = "Outbound"; status = "invented"; assert.equal((await request()).code, 502);
  for (const code of [403, 404, 429, 500]) {
    upstream = code;
    const res = await request();
    assert.equal(res.data.success, false);
    assert.doesNotMatch(JSON.stringify(res.data), /private-token|private-document|dummy-secret/);
    if (code === 403) assert.match(res.data.error, /ReadMessages/);
  }
});
