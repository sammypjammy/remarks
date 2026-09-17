import { readOutboundFax } from "./fax-status.js";

function fail(status, error) {
  return Object.assign(new Error(error), { status });
}

function validId(value) {
  return /^[1-9]\d{0,29}$/.test(value);
}

function safeFilename(value, messageId) {
  const base = String(value || `Fax document ${messageId}.pdf`).replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim();
  return (base || `Fax document ${messageId}.pdf`).slice(0, 120);
}

function attachmentMetadata(messageId, attachment) {
  const id = String(attachment.id || "");
  return {
    id,
    type: typeof attachment.type === "string" ? attachment.type : "Unknown",
    contentType: typeof attachment.contentType === "string" ? attachment.contentType : "application/octet-stream",
    fileName: safeFilename(attachment.fileName, messageId),
    size: Number.isSafeInteger(attachment.size) && attachment.size >= 0 ? attachment.size : null,
    downloadable: validId(id) && attachment.contentType === "application/pdf",
    downloadUrl: validId(id) && attachment.contentType === "application/pdf"
      ? `/api/fax-attachment?messageId=${encodeURIComponent(messageId)}&attachmentId=${encodeURIComponent(id)}`
      : null
  };
}

export function safeFaxMessage(messageId, data) {
  const attachments = Array.isArray(data.attachments)
    ? data.attachments.filter(attachment => attachment && validId(String(attachment.id))).map(attachmentMetadata.bind(null, messageId))
    : [];
  return {
    messageId,
    type: data.type,
    direction: data.direction,
    creationTime: data.creationTime || null,
    lastModifiedTime: data.lastModifiedTime || null,
    messageStatus: data.messageStatus || null,
    availability: data.availability || null,
    faxPageCount: Number.isSafeInteger(data.faxPageCount) ? data.faxPageCount : null,
    faxResolution: data.faxResolution || null,
    to: Array.isArray(data.to) ? data.to.map(recipient => ({
      location: recipient.location || null,
      phoneNumber: recipient.phoneNumber || null,
      messageStatus: recipient.messageStatus || null
    })) : [],
    from: data.from ? { location: data.from.location || null, phoneNumber: data.from.phoneNumber || null } : null,
    receiptAvailable: false,
    receiptNote: "RingCentral did not provide a separate confirmation document. The available Fax Receipt is the fax document returned as a RenderedDocument.",
    attachments
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const failResponse = (status, error) => res.status(status).json({ success: false, error });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return failResponse(405, "Use GET to view fax transmission details.");
  }
  const ids = new URL(req.url, "http://localhost").searchParams.getAll("messageId");
  if (ids.length !== 1 || !validId(ids[0])) return failResponse(400, "Provide one valid numeric message ID.");
  try {
    const { response, data } = await readOutboundFax(ids[0]);
    if (response.status === 403) return failResponse(403, "Transmission details access denied. Check the application's ReadMessages permission.");
    if (response.status === 404) return failResponse(404, "Fax record is not currently available.");
    if (response.status === 429) return failResponse(429, "RingCentral rate limit reached. Try again later.");
    if (!response.ok) return failResponse(502, "RingCentral transmission details are temporarily unavailable.");
    if (data.messageStatus !== "Sent") return failResponse(409, "Transmission details are available only after RingCentral reports Sent.");
    return res.status(200).json({ success: true, ...safeFaxMessage(ids[0], data) });
  } catch (error) {
    return failResponse(error.status || 502, error.status ? error.message : "Unable to retrieve transmission details.");
  }
}
