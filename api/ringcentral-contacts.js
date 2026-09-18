const BASE = "https://platform.ringcentral.com";
const PATH = "/restapi/v1.0/account/~/extension/~/address-book/contact";
const text = (value, limit = 120) => typeof value === "string" ? value.trim().slice(0, limit) : "";

function faxNumber(value) {
  const number = text(value, 100).replace(/[\s().-]/g, "");
  // The API documents E.164. Do not guess a country code or strip extension digits.
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : "";
}

export function normalizeContact(record) {
  if (!record || !/^[0-9]{1,30}$/.test(String(record.id)) ||
      ["Deleted", "Purged"].includes(record.availability)) return null;
  const id = String(record.id);
  const company = text(record.company);
  const name = [record.firstName, record.middleName, record.lastName].map(value => text(value, 60)).filter(Boolean).join(" ") ||
    text(record.nickName) || company || `Contact ${id}`;
  const faxNumbers = [];
  for (const [field, label] of [["businessFax", "Business fax"], ["otherFax", "Other fax"]]) {
    const number = faxNumber(record[field]);
    if (number && !faxNumbers.some(fax => fax.number === number)) faxNumbers.push({ label, number });
  }
  const location = [record.businessAddress?.city, record.businessAddress?.state].map(value => text(value, 60)).filter(Boolean).join(", ");
  // Only destination-picker fields; no notes, emails, street addresses, or phone fallbacks.
  return { id, name, company, location, faxNumbers };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const fail = (status, error) => res.status(status).json({ success: false, error });
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return fail(405, "Use GET to load or POST to save a fax contact.");
  }
  const creating = req.method === "POST";
  let name, number;
  if (creating) {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => !["name", "faxNumber"].includes(key)) ||
        typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 60 ||
        /[\u0000-\u001f\u007f]/.test(body.name) ||
        typeof body.faxNumber !== "string" || !/^\+[1-9]\d{7,14}$/.test(body.faxNumber)) {
      return fail(400, "Provide a contact name (1–60 characters) and an E.164 fax number only.");
    }
    name = body.name.trim();
    number = body.faxNumber;
  }
  try {
    const { RC_CLIENT_ID, RC_CLIENT_SECRET, RC_USER_JWT } = process.env;
    if (!RC_CLIENT_ID || !RC_CLIENT_SECRET || !RC_USER_JWT) return fail(500, "RingCentral server configuration is missing.");
    const signal = AbortSignal.timeout(45_000);
    const auth = await fetch(`${BASE}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json"
      },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: RC_USER_JWT }), signal
    });
    if (!auth.ok) return fail(502, "RingCentral contact authentication failed. Enter a fax number manually.");
    const token = await auth.json();
    if (typeof token.access_token !== "string" || !token.access_token) throw new Error("Invalid authentication response");
    const contacts = new Map();
    // RingCentral caps personal address books at 10,000 records. Guard malformed paging too.
    for (let page = 1; page <= 100; page++) {
      const response = await fetch(`${BASE}${PATH}?page=${page}&perPage=1000`, {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" }, signal
      });
      if (response.status === 403) return fail(403, "Contact access denied. Enable ReadContacts and verify the user's ReadPersonalContacts permission. Enter a fax number manually.");
      if (response.status === 429) return fail(429, "RingCentral contact rate limit reached. Try loading contacts later or enter a fax number manually.");
      if (!response.ok) throw new Error("Contact lookup failed");
      const data = await response.json();
      if (!Array.isArray(data.records)) throw new Error("Invalid contacts response");
      for (const record of data.records) {
        const contact = normalizeContact(record);
        if (contact) contacts.set(contact.id, contact);
      }
      if (contacts.size > 10000) throw new Error("Address book exceeds supported size");
      if (data.paging?.page != null && data.paging.page !== page) throw new Error("Unexpected contacts page");
      const totalPages = data.paging?.totalPages;
      if (totalPages != null && (!Number.isInteger(totalPages) || totalPages < 0)) throw new Error("Invalid paging");
      const hasNext = data.navigation?.nextPage || (totalPages != null ? page < totalPages : data.records.length === (data.paging?.perPage || 1000));
      if (hasNext && !data.records.length) throw new Error("Empty intermediate page");
      if (!hasNext) {
        if (creating) {
          // Refresh the complete personal address book before writing, including retries
          // after an uncertain response. Never create when duplicate checking failed.
          const existing = [...contacts.values()].find(contact => contact.faxNumbers.some(fax => fax.number === number));
          if (existing) return res.status(200).json({ success: true, contact: existing, existing: true });
          // RingCentral PersonalContactRequest: firstName and businessFax (E.164).
          // https://github.com/ringcentral/RingCentral.Net/blob/master/RingCentral.Net/Definitions/PersonalContactRequest.cs
          const created = await fetch(`${BASE}${PATH}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ firstName: name, businessFax: number }), signal
          });
          if (created.status === 403) return fail(403, "Saving contacts requires the RingCentral app Contacts (CRUD) permission and the user's EditPersonalContacts permission. ReadContacts alone is insufficient. Manual faxing is still available.");
          if (created.status === 429) return fail(429, "RingCentral contact rate limit reached. Try saving later. Manual faxing is still available.");
          if (!created.ok) return fail(502, "Contact save could not be confirmed. Refresh contacts before trying again. Manual faxing is still available.");
          const contact = normalizeContact(await created.json());
          if (!contact || !contact.faxNumbers.some(fax => fax.number === number)) throw new Error("Invalid saved contact");
          return res.status(201).json({ success: true, contact });
        }
        const payload = { success: true, contacts: [...contacts.values()] };
        if (Buffer.byteLength(JSON.stringify(payload)) > 4_000_000) throw new Error("Contacts response too large");
        return res.status(200).json(payload);
      }
      // Construct the next fixed-origin URL ourselves; never follow upstream navigation URLs.
    }
    throw new Error("Contact pagination did not complete");
  } catch {
    return fail(502, creating ? "Contact save could not be confirmed. Refresh contacts before trying again. Manual faxing is still available." : "Couldn't load all RingCentral contacts. Enter a fax number manually.");
  }
}
