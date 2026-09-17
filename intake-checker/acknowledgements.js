// One render's UI-only state. Original items and validator output remain untouched.
export function createAcknowledgements(items) {
  const reviewed = new Set();
  return {
    review(item) { if (items.includes(item)) reviewed.add(item); },
    remaining() { return items.filter(item => !reviewed.has(item)); }
  };
}

export function validationSummary(issues, remaining, partial) {
  if (!issues.length) return {
    text: partial ? "No issues found in the recognized data. Parsing needs review." : "No issues found under the active V1 rules.",
    success: !partial
  };
  if (!remaining.length) return { text: "All validation issues reviewed", success: false };
  const errors = remaining.filter(issue => issue.severity === "error").length;
  const warnings = remaining.length - errors;
  return {
    text: `${remaining.length} issue${remaining.length === 1 ? "" : "s"} requiring attention · ${errors} error${errors === 1 ? "" : "s"} · ${warnings} warning${warnings === 1 ? "" : "s"}`,
    success: false
  };
}
