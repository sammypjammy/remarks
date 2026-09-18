import test from "node:test";
import assert from "node:assert/strict";
import handler, { normalizeContact } from "../api/ringcentral-contacts.js";
import { filterContacts } from "../fax-sender/contacts.js";

test("contact normalization uses only fax fields and retains multiple fax choices", () => {
  const contact = normalizeContact({ id: 12, firstName: "Albuquerque", lastName: "SSA", company: "Social Security",
    businessAddress: { city: "Albuquerque", state: "NM", street: "private street" },
    businessFax: "+1 (866) 555-1234", otherFax: "+18335555678", mobilePhone: "+18015550000", notes: "private notes" });
  assert.deepEqual(contact, { id: "12", name: "Albuquerque SSA", company: "Social Security", location: "Albuquerque, NM",
    faxNumbers: [{ label: "Business fax", number: "+18665551234" }, { label: "Other fax", number: "+18335555678" }] });
  assert.deepEqual(normalizeContact({ id: 1, businessFax: "+18015551234" }).faxNumbers, [{ label: "Business fax", number: "+18015551234" }]);
  assert.equal(normalizeContact({ id: 1, businessFax: "+18015551234", otherFax: "+1 (801) 555-1234" }).faxNumbers.length, 1);
  for (const fields of [{ mobilePhone: "+18015551234" }, { homePhone: "+18015551234" }, { businessPhone: "+18015551234" }, { businessFax: "8015551234" }, { businessFax: "+18015551234 ext 9" }]) {
    assert.deepEqual(normalizeContact({ id: 1, ...fields }).faxNumbers, []);
  }
  assert.equal(normalizeContact({ id: 1, availability: "Deleted" }), null);
  assert.equal(normalizeContact({ id: "bad" }), null);
  assert.equal(filterContacts([contact], "albu").length, 1);
  assert.equal(filterContacts([contact], "security nm").length, 1);
  assert.equal(filterContacts([contact], "El Paso").length, 0);
});

async function request(method = "GET", body) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ method, body }, res);
  return res;
}

test("contacts endpoint authenticates server-side, paginates, and fails without leaking payloads", async t => {
  const original = globalThis.fetch;
  const keys = ["RC_CLIENT_ID", "RC_CLIENT_SECRET", "RC_USER_JWT"];
  const env = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = "dummy-secret"; });
  t.after(() => {
    globalThis.fetch = original;
    keys.forEach((key, i) => { if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i]; });
  });
  globalThis.fetch = () => { throw new Error("Must not fetch"); };
  assert.equal((await request("DELETE")).code, 405);
  for (const pagingStyle of ["totalPages", "navigation", "pageSize"]) {
    const pages = [];
    globalThis.fetch = async (url, options) => {
      if (url.endsWith("/oauth/token")) {
        assert.equal(options.method, "POST");
        assert.equal(options.body.get("assertion"), "dummy-secret");
        return Response.json({ access_token: "private-token" });
      }
      assert.equal(options.headers.Authorization, "Bearer private-token");
      assert.equal(options.method, undefined);
      const expected = "https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/address-book/contact";
      const parsed = new URL(url);
      assert.equal(parsed.origin + parsed.pathname, expected);
      assert.equal(parsed.searchParams.get("perPage"), "1000");
      const page = Number(parsed.searchParams.get("page")); pages.push(page);
      return Response.json({
        records: page <= 2 ? [{ id: page, firstName: `Office ${page}`, businessFax: "+18015551234", notes: "private-token" }] : [],
        paging: { page, ...(pagingStyle === "totalPages" ? { totalPages: 2 } : pagingStyle === "pageSize" ? { perPage: 1 } : {}) },
        ...(pagingStyle === "navigation" && page === 1 ? { navigation: { nextPage: { uri: "https://untrusted.invalid/" } } } : {})
      });
    };
    const res = await request();
    assert.equal(res.code, 200);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.deepEqual(pages, pagingStyle === "pageSize" ? [1, 2, 3] : [1, 2]);
    assert.deepEqual(res.data.contacts.map(c => c.id), ["1", "2"]);
    assert.doesNotMatch(JSON.stringify(res.data), /private-token|dummy-secret|notes/);
  }
  for (const status of [403, 429, 500]) {
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1 ? Response.json({ access_token: "private-token" }) : Response.json({ error: "private-token dummy-secret" }, { status });
    const res = await request();
    assert.equal(res.code, status === 500 ? 502 : status);
    assert.equal(res.data.success, false);
    assert.equal(res.data.contacts, undefined);
    assert.doesNotMatch(JSON.stringify(res.data), /private-token|dummy-secret/);
    if (status === 403) assert.match(res.data.error, /ReadContacts/);
  }
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) return Response.json({ access_token: "private-token" });
    if (calls === 2) return Response.json({ records: [{ id: 1 }], paging: { totalPages: 2 } });
    throw new Error("private-token");
  };
  assert.equal((await request()).data.contacts, undefined); // Never return a partial address book as complete.
});

test("contact creation validates, checks duplicates, uses businessFax, and explains write permission failures", async t => {
  const original = globalThis.fetch;
  const keys = ["RC_CLIENT_ID", "RC_CLIENT_SECRET", "RC_USER_JWT"];
  const env = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = "dummy-secret"; });
  t.after(() => {
    globalThis.fetch = original;
    keys.forEach((key, i) => { if (env[i] === undefined) delete process.env[key]; else process.env[key] = env[i]; });
  });
  const body = { name: "SSA Office", faxNumber: "+18335551234" };
  globalThis.fetch = () => { throw new Error("Validation must precede fetch"); };
  for (const invalid of [undefined, {}, { ...body, name: " " }, { ...body, name: "a".repeat(61) }, { ...body, faxNumber: "8335551234" }, { ...body, url: "https://example.com" }]) {
    assert.equal((await request("POST", invalid)).code, 400);
  }
  let writes = 0, records = [], createStatus = 201, readStatus = 200;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/oauth/token")) return Response.json({ access_token: "private-token" });
    if (options.method !== "POST") return Response.json({ records, paging: { totalPages: 1 } }, { status: readStatus });
    writes++;
    assert.equal(url, "https://platform.ringcentral.com/restapi/v1.0/account/~/extension/~/address-book/contact");
    assert.deepEqual(JSON.parse(options.body), { firstName: "SSA Office", businessFax: body.faxNumber });
    return Response.json({ id: 9, firstName: "SSA Office", businessFax: body.faxNumber, notes: "private-token" }, { status: createStatus });
  };
  const created = await request("POST", body);
  assert.equal(created.code, 201);
  assert.equal(created.data.contact.name, "SSA Office");
  assert.doesNotMatch(JSON.stringify(created.data), /private-token|dummy-secret|notes/);
  records = [{ id: 7, firstName: "Already saved", otherFax: body.faxNumber }];
  assert.equal((await request("POST", body)).data.existing, true);
  assert.equal(writes, 1);
  records = []; createStatus = 403;
  const denied = await request("POST", body);
  assert.equal(denied.code, 403);
  assert.match(denied.data.error, /Contacts \(CRUD\).*EditPersonalContacts/);
  readStatus = 503;
  const before = writes;
  assert.equal((await request("POST", body)).code, 502);
  assert.equal(writes, before, "Incomplete duplicate check must never create a contact");
});
