import { parseIntake, summarizeIntake } from "./parser.js";
import { validateIntake } from "./validation.js";
import { issueSource, findInTextarea } from "./source-location.js";
import { reviewIntake } from "./review.js";

const input = document.getElementById("intakeText");
const results = document.getElementById("intakeResults");
const message = document.getElementById("intakeMessage");
const summary = document.getElementById("intakeSummary");
function clearResults() {
  results.hidden = true;
  summary.replaceChildren();
  document.getElementById("intakeEmpty").hidden = false;
  message.textContent = "";
  document.getElementById("validationIssues").replaceChildren();
  document.getElementById("validationSummary").textContent = "";
  delete document.getElementById("validationSummary").dataset.success;
  document.querySelector(".intake-output").scrollTop = 0;
  document.getElementById("intakeReview").hidden = true;
  document.getElementById("reviewDivider").hidden = true;
  document.getElementById("reviewClient").replaceChildren();
  document.getElementById("reviewItems").replaceChildren();
  document.getElementById("validationReport").hidden = true;
}
function reset() { input.value = ""; input.setSelectionRange(0, 0); input.scrollTop = 0; clearResults(); }
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
  message.textContent = partial ? "Some text could not be placed in a section. Validation may be incomplete; review the pasted intake." : "Intake checked. Select Find in Intake to locate an issue.";
  if (parsed.sections.length) {
    renderReview(reviewIntake(parsed));
    renderReport(validateIntake(parsed), partial, parsed);
    document.getElementById("validationReport").hidden = false;
  } else {
    message.textContent = "The intake could not be reliably parsed: no sections were recognized. Validation was not run. Copy the intake again and review the pasted text.";
  }
  document.getElementById("intakeEmpty").hidden = true;
  results.hidden = false;
});

function renderReport(report, partial, parsed) {
  const errors = report.issues.filter(issue => issue.severity === "error").length;
  const warnings = report.issues.length - errors;
  document.getElementById("validationSummary").textContent = report.issues.length
    ? `${errors} error${errors === 1 ? "" : "s"} · ${warnings} review warning${warnings === 1 ? "" : "s"}`
    : partial ? "No issues found in the recognized data. Parsing needs review." : "No issues found under the active V1 rules.";
  document.getElementById("validationSummary").dataset.success = String(!report.issues.length && !partial);
  const list = document.getElementById("validationIssues");
  for (const issue of report.issues) {
    const row = document.createElement("li");
    row.dataset.severity = issue.severity;
    const title = document.createElement("strong");
    title.textContent = [issue.severity === "error" ? "Error" : "Review", issue.section, issue.record, issue.field].filter(Boolean).join(" · ");
    const reason = document.createElement("p");
    reason.textContent = issue.message.replace("parsed structure", "pasted intake");
    row.append(title, reason);
    const range = issueSource(parsed, issue);
    if (range) {
      row.append(locateButton(range, [issue.section, issue.record, issue.field].filter(Boolean).join(" / ")));
    }
    if (issue.record && issue.location) {
      const location = document.createElement("small");
      location.textContent = `Record ${Number(issue.location.split("/").at(-1)) + 1} in this group`;
      row.append(location);
    }
    list.append(row);
  }
}

function locateButton(range, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-btn intake-locate";
  button.textContent = "Find in Intake";
  button.setAttribute("aria-label", `Find in Intake: ${label}`);
  button.addEventListener("click", () => findInTextarea(input, range));
  return button;
}

function renderReview(review) {
  const client = document.getElementById("reviewClient");
  for (const [label, value, empty] of [
    ["Client name / last four of SSN", review.identifier, "Client name and last four unavailable"],
    ["Email", review.email, "Email not provided"]
  ]) {
    const row = document.createElement("p");
    if (value) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-btn review-copy";
      button.textContent = value;
      button.setAttribute("aria-label", `Copy ${label}: ${value}`);
      const status = document.createElement("span");
      status.className = "copy-status";
      status.setAttribute("role", "status");
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(value);
          if (button.isConnected) status.textContent = "Copied";
        } catch {
          if (button.isConnected) status.textContent = "Could not copy. Try again.";
        }
        setTimeout(() => { status.textContent = ""; }, 2000);
      });
      row.append(button, status);
    } else row.textContent = empty;
    client.append(row);
  }
  const list = document.getElementById("reviewItems");
  const empty = document.getElementById("reviewEmpty");
  empty.hidden = review.items.length > 0;
  for (const item of review.items) {
    const row = document.createElement("li");
    row.dataset.severity = "warning";
    const title = document.createElement("strong");
    title.textContent = item.message;
    row.append(title);
    const actions = document.createElement("div");
    if (item.range) actions.append(locateButton(item.range, item.message));
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "secondary-btn intake-locate";
    dismiss.textContent = "Reviewed";
    dismiss.setAttribute("aria-label", `Reviewed: ${item.message}`);
    dismiss.addEventListener("click", () => {
      const next = row.nextElementSibling?.querySelector("button") || row.previousElementSibling?.querySelector("button");
      row.remove();
      empty.hidden = list.children.length > 0;
      (next || client.querySelector("button"))?.focus();
    });
    actions.append(dismiss);
    row.append(actions);
    list.append(row);
  }
  document.getElementById("intakeReview").hidden = false;
  document.getElementById("reviewDivider").hidden = false;
}
