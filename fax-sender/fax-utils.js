export function validFaxMessageId(value) {
  return /^[1-9]\d{0,29}$/.test(value);
}

export function safeFaxFilename(value, messageId) {
  const base = String(value || `Fax document ${messageId}.pdf`).replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim();
  return (base || `Fax document ${messageId}.pdf`).slice(0, 120);
}
