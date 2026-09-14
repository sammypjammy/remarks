import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import handler from "../api/send-fax.js";

function upload({ number = "+1 (801) 555-1234", content = "%PDF-1.4\n%%EOF", name = "test.pdf", type = "application/pdf", count = 1 } = {}) {
  const form = new FormData();
  form.append("faxNumber", number);
  for (let i = 0; i < count; i++) form.append("file", new Blob([content], { type }), name);
  return form;
}

async function invoke(form, method = "POST") {
  const encoded = new Response(form);
  const req = Readable.from([Buffer.from(await encoded.arrayBuffer())]);
  req.method = method;
  req.headers = { "content-type": encoded.headers.get("content-type") };
  const res = {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; }
  };
  await handler(req, res);
  return res;
}

test("fax endpoint validation, multipart submission, and safe failures", async t => {
  const originalFetch = globalThis.fetch;
  const keys = ["RC_CLIENT_ID", "RC_CLIENT_SECRET", "RC_USER_JWT"];
  const originalEnv = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = `dummy-${key}`; });
  t.after(() => {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => { if (originalEnv[i] === undefined) delete process.env[key]; else process.env[key] = originalEnv[i]; });
  });

  await t.test("rejects invalid requests before authentication", async () => {
    globalThis.fetch = () => { throw new Error("Must not authenticate"); };
    const get = await invoke(upload(), "GET");
    assert.equal(get.code, 405);
    assert.equal(get.headers.Allow, "POST");
    for (const options of [
      { number: "" }, { number: "18015551234" }, { count: 0 }, { count: 2 },
      { name: "test.txt" }, { type: "text/plain" }, { content: "not a PDF" },
      { content: "" }, { content: "%PDF-" + "a".repeat(4_000_000) }
    ]) {
      assert.equal((await invoke(upload(options))).code, 400);
    }
    const extra = upload();
    extra.append("faxNumber", "+18015550000");
    assert.equal((await invoke(extra)).code, 400);
    const extraFile = upload();
    extraFile.append("other", new Blob(["%PDF-"]), "other.pdf");
    assert.equal((await invoke(extraFile)).code, 400);
    assert.equal((await invoke("invalid multipart")).code, 415);
    assert.equal((await invoke(upload({ content: "a".repeat(4_100_000) }))).code, 413);
  });

  await t.test("uses JWT on server and submits exactly one document to one number", async () => {
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      if (calls === 1) {
        assert.equal(url, "https://platform.ringcentral.com/restapi/oauth/token");
        assert.equal(options.body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
        assert.equal(options.body.get("assertion"), "dummy-RC_USER_JWT");
        assert.equal(options.headers.Authorization, `Basic ${Buffer.from("dummy-RC_CLIENT_ID:dummy-RC_CLIENT_SECRET").toString("base64")}`);
        return Response.json({ access_token: "private-token" });
      }
      assert.equal(url, "https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/fax");
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.equal(options.headers["Content-Type"], undefined);
      const wire = await new Response(options.body).formData();
      assert.deepEqual([...wire.keys()], ["json", "attachment"]);
      assert.deepEqual(JSON.parse(await wire.get("json").text()), {
        to: [{ phoneNumber: "+18015551234" }], faxResolution: "High", coverIndex: 0
      });
      assert.equal(wire.get("attachment").type, "application/pdf");
      assert.equal(await wire.get("attachment").text(), "%PDF-1.4\n%%EOF");
      return Response.json({ id: 12345, messageStatus: "Queued", access_token: "private-token", other: "private" });
    };
    const res = await invoke(upload());
    assert.equal(calls, 2);
    assert.equal(res.code, 200);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.deepEqual(res.data, { success: true, messageId: "12345", status: "Queued" });
  });

  await t.test("redacts upstream errors and never retries ambiguous submissions", async () => {
    for (const upstreamStatus of [400, 401, 403, 429, 500]) {
      let calls = 0;
      globalThis.fetch = async () => {
        if (++calls === 1) return Response.json({ access_token: "private-token" });
        return Response.json({ error: "private-token dummy-RC_USER_JWT" }, { status: upstreamStatus });
      };
      const res = await invoke(upload());
      assert.equal(calls, 2);
      assert.equal(res.data.success, false);
      assert.doesNotMatch(JSON.stringify(res.data), /private-token|dummy-/);
    }
    globalThis.fetch = async () => Response.json({ error_description: "dummy-RC_CLIENT_SECRET" }, { status: 401 });
    assert.match((await invoke(upload())).data.error, /authentication failed/);
    let calls = 0;
    globalThis.fetch = async () => {
      if (++calls === 1) return Response.json({ access_token: "private-token" });
      throw new Error("private-token");
    };
    const res = await invoke(upload());
    assert.equal(calls, 2);
    assert.equal(res.code, 502);
    assert.match(res.data.error, /before retrying/);
    assert.doesNotMatch(JSON.stringify(res.data), /private-token/);
  });
});
