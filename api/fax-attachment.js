import { accessToken, readOutboundFax } from "./fax-status.js";

const MAX_DOWNLOAD_BYTES = 10_000_000;

function validId(value) {
  return /^[1-9]\d{0,29}$/.test(value);
}

function safeFilename(value, messageId) {
  const base = String(value || `Fax document ${messageId}.pdf`).replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim();
  return (base || `Fax document ${messageId}.pdf`).slice(0, 120);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const fail = (status, error) => res.status(status).json({ success: false, error });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return fail(405, "Use GET to download a fax document.");
  }
  const params = new URL(req.url, "http://localhost").searchParams;
  const messageIds = params.getAll("messageId");
  const attachmentIds = params.getAll("attachmentId");
  if (messageIds.length !== 1 || attachmentIds.length !== 1 || !validId(messageIds[0]) || !validId(attachmentIds[0])) {
    return fail(400, "Provide one valid message ID and attachment ID.");
  }
  try {
    const { response, data } = await readOutboundFax(messageIds[0]);
    if (response.status === 403) return fail(403, "Fax document access denied. Check the application's ReadMessages permission.");
    if (response.status === 404) return fail(404, "Fax record is not currently available.");
    if (!response.ok) return fail(502, "RingCentral fax document is temporarily unavailable.");
    if (data.messageStatus !== "Sent") return fail(409, "The transmitted fax document is available only after RingCentral reports Sent.");
    const attachment = Array.isArray(data.attachments)
      ? data.attachments.find(item => String(item?.id) === attachmentIds[0])
      : null;
    if (!attachment || attachment.contentType !== "application/pdf" || typeof attachment.uri !== "string") {
      return fail(404, "That PDF attachment does not belong to the requested outbound fax.");
    }
    const token = await accessToken();
    const download = await fetch(attachment.uri, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" },
      signal: AbortSignal.timeout(30_000)
    });
    if (!download.ok) return fail(502, "RingCentral could not provide the fax document.");
    const length = Number(download.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_DOWNLOAD_BYTES) return fail(413, "The fax document is too large to download.");
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) return fail(413, "The fax document is too large to download.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(attachment.fileName, messageIds[0])}"`);
    return res.status(200).send(bytes);
  } catch {
    return fail(502, "Unable to download the fax document.");
  }
}
