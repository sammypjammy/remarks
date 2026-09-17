import { parseIntake, summarizeIntake } from "./parser.js";
import { validateIntake } from "./validation.js";

const input = document.getElementById("intakeText");
const results = document.getElementById("intakeResults");
const message = document.getElementById("intakeMessage");
const summary = document.getElementById("intakeSummary");
const debug = document.getElementById("parsedIntake");
function clearResults() {
  results.hidden = true;
  summary.replaceChildren();
  debug.textContent = "";
  message.textContent = "";
  document.getElementById("validationIssues").replaceChildren();
  document.getElementById("validationSummary").textContent = "";
  document.getElementById("validationLimits").textContent = "";
  document.getElementById("validationReport").hidden = true;
  document.getElementById("intakeDebug").open = false;
}
function reset() { input.value = ""; clearResults(); }
input.addEventListener("input", clearResults);
document.getElementById("clearIntake").addEventListener("click", () => { reset(); input.focus(); });
// Avoid restoring client text/results through back-forward page caching.
window.addEventListener("pagehide", reset);
document.getElementById("intakeForm").addEventListener("submit", event => {
  event.preventDefault();
  clearResults();
  if (!input.value.trim()) {
    message.textContent = "Paste the DeLorean intake text first.";
    input.focus();
    return;
  }
  const parsed = parseIntake(input.value);
  const labels = { client: "Client", sections: "Sections Found", providers: "Medical Providers", medications: "Medications", jobs: "Work History Entries" };
  for (const [key, value] of Object.entries(summarizeIntake(parsed))) {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = labels[key];
    description.textContent = value;
    summary.append(term, description);
  }
  const partial = !parsed.sections.length || parsed.unparsed.length > 0;
  document.getElementById("resultsTitle").textContent = partial ? "Review Parsed Intake" : "Intake Parsed Successfully";
  message.textContent = partial ? "Some text could not be placed in a section. Validation may be incomplete; review the unparsed entries in the debug view." : "Parsing complete. Review the V1 validation report below.";
  if (parsed.sections.length) {
    renderReport(validateIntake(parsed), partial);
    document.getElementById("validationReport").hidden = false;
  } else {
    message.textContent = "The intake could not be reliably parsed: no sections were recognized. Validation was not run. Copy the intake again and review the Parsed structure below.";
  }
  debug.textContent = JSON.stringify(parsed, null, 2);
  results.hidden = false;
});

function renderReport(report, partial) {
  const errors = report.issues.filter(issue => issue.severity === "error").length;
  const warnings = report.issues.length - errors;
  document.getElementById("validationSummary").textContent = report.issues.length
    ? `${errors} error${errors === 1 ? "" : "s"} · ${warnings} review warning${warnings === 1 ? "" : "s"}`
    : partial ? "No issues found in the recognized data. Parsing needs review." : "No issues found under the active V1 rules.";
  document.getElementById("validationLimits").textContent = report.deferred.join(" ");
  const list = document.getElementById("validationIssues");
  for (const issue of report.issues) {
    const row = document.createElement("li");
    row.dataset.severity = issue.severity;
    const title = document.createElement("strong");
    title.textContent = [issue.severity === "error" ? "Error" : "Review", issue.section, issue.record, issue.field].filter(Boolean).join(" · ");
    const reason = document.createElement("p");
    reason.textContent = issue.message;
    row.append(title, reason);
    if (issue.record && issue.location) {
      const location = document.createElement("small");
      location.textContent = `Record ${Number(issue.location.split("/").at(-1)) + 1} in this group`;
      row.append(location);
    }
    list.append(row);
  }
}
