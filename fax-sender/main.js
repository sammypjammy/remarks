const form = document.getElementById("faxForm");
const numberInput = document.getElementById("faxNumber");
const fileInput = document.getElementById("pdfFile");
const fields = document.getElementById("faxFields");
const button = document.getElementById("sendFax");
const validation = document.getElementById("validation");
const result = document.getElementById("faxResult");
let sending = false;

function validate() {
  const number = numberInput.value.replace(/[\s().-]/g, "");
  const file = fileInput.files[0];
  let error = "";
  if (!/^\+[1-9]\d{7,14}$/.test(number)) error = "Enter a fax number with + and country code.";
  else if (fileInput.files.length !== 1) error = "Select exactly one PDF.";
  else if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) error = "Only PDF files are accepted.";
  else if (!file.size || file.size > 4_000_000) error = "Select a nonempty PDF of 4 MB or smaller.";
  validation.textContent = error;
  button.disabled = sending || Boolean(error);
  return !error;
}
form.addEventListener("input", validate);
form.addEventListener("change", validate);
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (sending || !validate()) return;
  const body = new FormData(form);
  sending = true;
  fields.disabled = true;
  button.disabled = true;
  button.textContent = "Sending…";
  form.setAttribute("aria-busy", "true");
  result.dataset.error = "false";
  result.textContent = "Submitting fax to RingCentral…";
  try {
    if (await fileInput.files[0].slice(0, 5).text() !== "%PDF-") throw new Error("The selected file does not have a PDF header.");
    const response = await fetch("/api/send-fax", { method: "POST", body });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || (response.status === 413 ? "The upload is too large. Select a PDF under 4 MB." : "Submission could not be confirmed. Check RingCentral before retrying."));
    }
    result.textContent = `Accepted by RingCentral. Message ID: ${data.messageId}. Status: ${data.status}. Check RingCentral for final delivery confirmation.`;
    fileInput.value = "";
  } catch (error) {
    result.dataset.error = "true";
    result.textContent = error instanceof TypeError ? "Connection lost. Check RingCentral's sent faxes before retrying to avoid duplicates." : error.message;
  } finally {
    sending = false;
    fields.disabled = false;
    button.textContent = "Send Fax";
    form.setAttribute("aria-busy", "false");
    validate();
  }
});
