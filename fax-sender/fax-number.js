export function normalizeFaxNumber(value) {
  return String(value || "").replace(/[\s().-]/g, "");
}

export function validFaxNumber(value) {
  return /^\+[1-9]\d{7,14}$/.test(normalizeFaxNumber(value));
}
