// Keep the multipart bytes intact in Vercel's Node runtime.
export const config = { api: { bodyParser: false } };
const BASE_URL = "https://platform.ringcentral.com";
// Official en-US dictionary: Classic = 5, None = 0.
// https://github.com/ringcentral/ringcentral-api-docs/blob/main/specs/ringcentral_openapi3.json
const CLASSIC_COVER_INDEX = 5;
const MAX_PDF_BYTES = 4_000_000;
const MAX_REQUEST_BYTES = MAX_PDF_BYTES + 32_000;

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

async function readUpload(req) {
  const contentType = req.headers["content-type"] || "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw fail(415, "Upload one PDF using multipart/form-data.");
  }
  if (Number(req.headers["content-length"]) > MAX_REQUEST_BYTES) {
    throw fail(413, "The PDF must be 4 MB or smaller.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw fail(413, "The PDF must be 4 MB or smaller.");
    chunks.push(chunk);
  }
  let form;
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw fail(400, "The upload could not be read. Select one PDF and try again.");
  }
  if ([...form.keys()].some(key => !["faxNumber", "file", "includeCoverSheet", "recipientName"].includes(key)) ||
      form.getAll("faxNumber").length !== 1 || form.getAll("file").length !== 1) {
    throw fail(400, "Provide exactly one fax number and one PDF.");
  }
  const covers = form.getAll("includeCoverSheet");
  const names = form.getAll("recipientName");
  // Older clients retain their no-cover behavior when the flag is absent.
  if (covers.length > 1 || (covers.length && !["true", "false"].includes(covers[0])) ||
      names.length > 1 || (names.length && (typeof names[0] !== "string" || names[0].length > 200 || /[\u0000-\u001f\u007f]/.test(names[0])))) {
    throw fail(400, "Provide a true/false cover-sheet choice and a valid recipient name.");
  }
  const includeCoverSheet = covers[0] === "true";
  const recipientName = names[0]?.trim() || "";
  const number = form.get("faxNumber");
  const file = form.get("file");
  const faxNumber = typeof number === "string" ? number.replace(/[\s().-]/g, "") : "";
  if (!/^\+[1-9]\d{7,14}$/.test(faxNumber)) {
    throw fail(400, "Enter a fax number with + and country code, such as +18015551234.");
  }
  if (typeof file === "string" || !file || !/\.pdf$/i.test(file.name) ||
      (file.type && file.type !== "application/pdf")) {
    throw fail(400, "Select exactly one PDF file.");
  }
  if (!file.size || file.size > MAX_PDF_BYTES) throw fail(400, "Select a nonempty PDF of 4 MB or smaller.");
  if (await file.slice(0, 5).text() !== "%PDF-") throw fail(400, "The selected file does not have a PDF header.");
  return { faxNumber, file, includeCoverSheet, recipientName };
}

function upstreamError(status, authenticating) {
  if (status === 429) return fail(429, "RingCentral rate limit reached. Wait before trying again.");
  if (authenticating) return fail(502, "RingCentral authentication failed. Check the server credentials, JWT authorization, and application configuration.");
  if (status === 403) return fail(403, "RingCentral denied fax access. Check the application's Faxes permission and the JWT user's fax-enabled extension.");
  if (status === 401) return fail(502, "RingCentral rejected server authentication. Check the application's authorization.");
  if (status === 400) return fail(400, "RingCentral rejected the fax. Check the destination and that the PDF opens correctly and is not password protected.");
  return fail(502, "RingCentral could not confirm fax submission. Check RingCentral's sent faxes before retrying to avoid duplicates.");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const respond = (status, data) => res.status(status).json(data);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(405, { success: false, error: "Use POST to send a fax." });
  }
  try {
    const { faxNumber, file, includeCoverSheet, recipientName } = await readUpload(req);
    const { RC_CLIENT_ID, RC_CLIENT_SECRET, RC_USER_JWT } = process.env;
    if (!RC_CLIENT_ID || !RC_CLIENT_SECRET || !RC_USER_JWT) {
      throw fail(500, "RingCentral server configuration is missing. Set RC_CLIENT_ID, RC_CLIENT_SECRET, and RC_USER_JWT.");
    }
    const auth = await fetch(`${BASE_URL}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: RC_USER_JWT }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!auth.ok) throw upstreamError(auth.status, true);
    const token = await auth.json();
    if (typeof token.access_token !== "string" || !token.access_token) throw upstreamError(502, true);

    const multipart = new FormData();
    multipart.append("json", new Blob([JSON.stringify({
      to: [{ phoneNumber: faxNumber, ...(includeCoverSheet && recipientName ? { name: recipientName } : {}) }],
      faxResolution: "High", coverIndex: includeCoverSheet ? CLASSIC_COVER_INDEX : 0
    })], { type: "application/json" }), "request.json");
    multipart.append("attachment", file, "document.pdf");
    // One submission only: retrying an ambiguous failure could send a duplicate fax.
    const response = await fetch(`${BASE_URL}/restapi/v1.0/account/~/extension/~/fax`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      body: multipart,
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw upstreamError(response.status, false);
    const data = await response.json();
    if (!/^[0-9]+$/.test(String(data.id))) throw upstreamError(502, false);
    const statuses = ["Queued", "Sending", "Sent", "Delivered", "SendingFailed", "DeliveryFailed", "Received"];
    return respond(200, { success: true, messageId: String(data.id), status: statuses.includes(data.messageStatus) ? data.messageStatus : "Accepted" });
  } catch (error) {
    // Never log or forward upstream payloads, request bodies, or exception details.
    return respond(error.status || 502, {
      success: false,
      error: error.status ? error.message : "Fax submission could not be confirmed. Check RingCentral's sent faxes before retrying to avoid duplicates."
    });
  }
}
