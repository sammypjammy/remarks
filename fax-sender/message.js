export async function lookupFaxMessage(messageId) {
  let response;
  try {
    response = await fetch(`/api/fax-message?messageId=${encodeURIComponent(messageId)}`, {
      cache: "no-store", signal: AbortSignal.timeout(25_000)
    });
  } catch (error) {
    const timedOut = ["TimeoutError", "AbortError"].includes(error?.name);
    throw new Error(timedOut ? "Transmission details lookup timed out." : "Could not reach the transmission details endpoint.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success || data.messageId !== messageId) {
    throw new Error(response.status === 403 ? "Transmission details access denied." :
      "Transmission details are currently unavailable.");
  }
  return data;
}

export function validLastFour(value) {
  return /^\d{4}$/.test(value);
}

export function receiptFilename(originalName, lastFour) {
  if (!(typeof originalName === "string" && originalName)) return `Fax Receipt - Document ${lastFour}.pdf`;
  const baseName = originalName.replace(/\.pdf$/i, "");
  const safeBase = baseName.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim();
  return `Fax Receipt - ${(safeBase || `Document ${lastFour}`).slice(0, 180)} ${lastFour}.pdf`;
}

const receiptBlobs = new WeakMap(); // Released with the document/attachment; never persisted.

export async function fetchFaxAttachment(downloadUrl, attachment) {
  if (attachment && receiptBlobs.has(attachment)) return receiptBlobs.get(attachment);
  let response;
  try {
    response = await fetch(downloadUrl, { cache: "no-store", signal: AbortSignal.timeout(35_000) });
  } catch (error) {
    const timedOut = ["TimeoutError", "AbortError"].includes(error?.name);
    throw new Error(timedOut ? "Fax Receipt download timed out." : "Could not reach the Fax Receipt endpoint.");
  }
  if (!response.ok) throw new Error("The Fax Receipt is currently unavailable.");
  const blob = await response.blob();
  if (attachment) receiptBlobs.set(attachment, blob);
  return blob;
}

export async function downloadFaxAttachment(downloadUrl, filename = "Fax Receipt.pdf", attachment) {
  saveReceiptBlob(await fetchFaxAttachment(downloadUrl, attachment), filename);
}

export function saveReceiptBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
