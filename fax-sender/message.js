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

export async function downloadFaxAttachment(downloadUrl, filename = "transmitted-fax-document.pdf") {
  let response;
  try {
    response = await fetch(downloadUrl, { cache: "no-store", signal: AbortSignal.timeout(35_000) });
  } catch (error) {
    const timedOut = ["TimeoutError", "AbortError"].includes(error?.name);
    throw new Error(timedOut ? "Download timed out." : "Could not reach the fax document endpoint.");
  }
  if (!response.ok) throw new Error("The transmitted fax document is currently unavailable.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
