const BASE = "https://platform.ringcentral.com";
let cachedToken;
let tokenRequest;

async function accessToken() {
  if (cachedToken?.until > Date.now()) return cachedToken.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const { RC_CLIENT_ID, RC_CLIENT_SECRET, RC_USER_JWT } = process.env;
    if (!RC_CLIENT_ID || !RC_CLIENT_SECRET || !RC_USER_JWT) throw new Error("configuration");
    const response = await fetch(`${BASE}/restapi/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${RC_CLIENT_ID}:${RC_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json"
      },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: RC_USER_JWT }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error("authentication");
    const data = await response.json();
    if (typeof data.access_token !== "string" || !data.access_token) throw new Error("authentication");
    // Server memory only; short cache avoids a JWT exchange for every status check.
    cachedToken = { value: data.access_token, until: Date.now() + Math.max(0, Math.min(300, Number(data.expires_in || 0) - 60)) * 1000 };
    return cachedToken.value;
  })();
  try { return await tokenRequest; } finally { tokenRequest = null; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const fail = (code, error) => res.status(code).json({ success: false, error });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return fail(405, "Use GET to check fax status.");
  }
  const ids = new URL(req.url, "http://localhost").searchParams.getAll("messageId");
  if (ids.length !== 1 || !/^[1-9]\d{0,29}$/.test(ids[0])) return fail(400, "Provide one valid numeric message ID.");
  const messageId = ids[0];
  try {
    const token = await accessToken();
    const response = await fetch(`${BASE}/restapi/v1.0/account/~/extension/~/message-store/${messageId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 401 || response.status === 403) cachedToken = null;
    if (response.status === 403) return fail(403, "Status access denied. Check the application's ReadMessages permission and the JWT user's message access.");
    if (response.status === 429) return fail(429, "RingCentral status rate limit reached. Status checking will try again later.");
    if (response.status === 404) return fail(404, "Fax record is not currently available. This does not mean delivery failed.");
    if (!response.ok) return fail(502, "RingCentral status is temporarily unavailable.");
    const data = await response.json();
    if (String(data.id) !== messageId || data.type !== "Fax" || data.direction !== "Outbound") {
      return fail(502, "The returned record could not be verified as this outbound fax.");
    }
    // Message-store enums include SMS/inbound states; only documented fax outcomes are terminal.
    const statuses = ["Queued", "Sent", "SendingFailed", "Delivered", "DeliveryFailed", "Received"];
    if (!statuses.includes(data.messageStatus)) return fail(502, "RingCentral returned an unrecognized fax status. Check RingCentral.");
    return res.status(200).json({ success: true, messageId, status: data.messageStatus,
      terminal: ["Sent", "SendingFailed"].includes(data.messageStatus) });
  } catch {
    return fail(502, "Unable to check fax status. Check server configuration and RingCentral availability. Delivery is not confirmed.");
  }
}
