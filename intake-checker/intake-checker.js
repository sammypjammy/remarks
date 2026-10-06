import { createIntakeHandoff } from "../ssa-intake-assistant/src/intake-handoff.jsx";
import { parseIntake } from "./parser.js";
import { createIntakeSession, correctIntakeField } from "./session.js";
import { issueSource, findInTextarea } from "./source-location.js";
import { validationSummary } from "./acknowledgements.js";

const input = document.getElementById("intakeText");
const results = document.getElementById("intakeResults");
const message = document.getElementById("intakeMessage");
let activeIntake = null;
const handoff = createIntakeHandoff({ onSource: range => findInTextarea(input, range), onAccessLost: () => reset(), onCorrect: applyCorrection });
function clearResults() {
  activeIntake = null;
  document.getElementById("intakeCorrections").replaceChildren();
  document.querySelector('#intakeNormalizations ul').replaceChildren();
  document.getElementById('intakeNormalizations').hidden = true;
  handoff.clear();
  document.getElementById("continueToSsa").hidden = true;
  results.hidden = true;
  document.getElementById("intakeEmpty").hidden = false;
  message.textContent = "";
  delete message.dataset.severity;
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
window.addEventListener("packardaccountchange", reset);
document.getElementById("continueToSsa").addEventListener("click", () => { if (activeIntake) handoff.open(activeIntake); });
document.getElementById("intakeForm").addEventListener("submit", event => {
  event.preventDefault();
  clearResults();
  if (!input.value.trim()) {
    message.textContent = "Paste the DeLorean intake text first.";
    input.focus();
    return;
  }
  const parsed = parseIntake(input.value);
  const partial = !parsed.sections.length || parsed.unparsed.length > 0;
  message.textContent = "Intake checked. Select Find in Intake to locate an issue.";
  if (parsed.sections.length) {
    activeIntake = createIntakeSession(parsed);
    renderNormalizations(activeIntake.report.formats);
    renderReview(activeIntake.review, activeIntake.reviewState);
    renderReport(activeIntake.report, partial, parsed, activeIntake.validationState);
    document.getElementById("continueToSsa").hidden = false;
    document.getElementById("validationReport").hidden = false;
  } else {
    message.dataset.severity = "error";
    message.textContent = "The intake could not be reliably parsed: no sections were recognized. Validation was not run. Copy the intake again and review the pasted text.";
  }
  document.getElementById("intakeEmpty").hidden = true;
  results.hidden = false;
});

function renderReport(report, partial, parsed, state) {
  const summary = document.getElementById("validationSummary");
  function updateSummary() {
    const result = validationSummary(report.issues, state.remaining(), partial);
    summary.textContent = result.text;
    summary.dataset.success = String(result.success);
  }
  updateSummary();
  const list = document.getElementById("validationIssues");
  for (const issue of state.remaining()) {
    const row = document.createElement("li");
    row.dataset.severity = issue.severity;
    const title = document.createElement("strong");
    title.textContent = [issue.severity === "error" ? "Error" : "Review", issue.section, issue.record, issue.field].filter(Boolean).join(" · ");
    const reason = document.createElement("p");
    reason.textContent = issue.message.replace("parsed structure", "pasted intake");
    row.append(title, reason);
    const actions = document.createElement("div");
    actions.className = "issue-actions";
    const ranges = issue.sources?.length ? issue.sources : [issueSource(parsed, issue)].filter(Boolean);
    ranges.forEach((range, index) => {
      const label = [issue.section, issue.record, issue.field].filter(Boolean).join(" / ");
      const button = locateButton(range, label + (ranges.length > 1 ? ' / occurrence ' + (index + 1) : ''));
      if (ranges.length > 1) button.textContent = 'Find answer ' + (index + 1);
      actions.append(button);
    });
    actions.append(reviewedButton(row, title.textContent, () => {
      state.review(issue);
      updateSummary();
    }, summary, "Ignore"));
    row.append(actions);
    if (issue.record && issue.location) {
      const location = document.createElement("small");
      location.textContent = `Record ${Number(issue.location.split("/").at(-1)) + 1} in this group`;
      row.append(location);
    }
    list.append(row);
  }
}

function renderNormalizations(formats) {
  const host = document.getElementById('intakeNormalizations');
  const list = host.querySelector('ul');
  list.replaceChildren();
  for (const [field, result] of formats) {
    if (result.error || result.value === field.value) continue;
    const row = document.createElement('li');
    row.textContent = `${field.label}: ${result.value}`;
    list.append(row);
  }
  host.hidden = !list.children.length;
}

function reviewedButton(row, label, acknowledge, fallback, action = "Reviewed") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-btn intake-reviewed";
  button.textContent = action;
  button.setAttribute("aria-label", `${action}: ${label}`);
  button.addEventListener("click", () => {
    const next = row.nextElementSibling?.querySelector("button") || row.previousElementSibling?.querySelector("button");
    acknowledge();
    row.remove();
    (next || fallback)?.focus();
  });
  return button;
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

function renderReview(review, state) {
  const client = document.getElementById("reviewClient");
  for (const [label, value, empty] of [
    ["Client name / last four of SSN", review.identifier, "Client name and last four unavailable"],
    ["Email", review.email, "Email not provided"]
  ]) {
    const row = document.createElement("p");
    if (value) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-copy";
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
  for (const item of state.remaining()) {
    const row = document.createElement("li");
    row.dataset.severity = "warning";
    const title = document.createElement("strong");
    title.textContent = item.message;
    row.append(title);
    const actions = document.createElement("div");
    actions.className = "issue-actions";
    if (item.range) actions.append(locateButton(item.range, item.message));
    const cannedRemarks = document.createElement("a");
    cannedRemarks.className = "secondary-btn intake-canned-remarks";
    cannedRemarks.href = "../canned-remarks/#things-to-notate-in-remarks";
    cannedRemarks.textContent = "Canned Remarks";
    cannedRemarks.setAttribute("aria-label", `Open Canned Remarks for ${item.message}`);
    actions.append(cannedRemarks);
    actions.append(reviewedButton(row, item.message, () => {
      state.review(item);
    }, client.querySelector("button") || document.getElementById("reviewTitle")));
    row.append(actions);
    list.append(row);
  }
  document.getElementById("intakeReview").hidden = false;
  document.getElementById("reviewDivider").hidden = false;
}

function applyCorrection(session, target, value) {
  if (session !== activeIntake || !correctIntakeField(session, target, value)) return false;
  for (const id of ['reviewClient', 'reviewItems', 'validationIssues']) document.getElementById(id).replaceChildren();
  renderReview(session.review, session.reviewState);
  renderReport(session.report, session.parsed.unparsed.length > 0, session.parsed, session.validationState);
  renderNormalizations(session.report.formats);
  const corrections = document.getElementById('intakeCorrections');
  corrections.replaceChildren();
  const note = document.createElement('p');
  note.textContent = 'Employee corrections are applied in memory. The pasted text remains the original source. Editing or rechecking it resets corrections.';
  corrections.append(note);
  const list = document.createElement('ul');
  for (const [field, edit] of session.edits) {
    const item = document.createElement('li');
    item.textContent = field.label + ': ' + edit.changes.at(-1).value;
    list.append(item);
  }
  corrections.append(list);
  return true;
}
