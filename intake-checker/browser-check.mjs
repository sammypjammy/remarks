import assert from "node:assert/strict";
// All fixtures are synthetic and were not copied from real clients or intakes.
import { intakeRules } from "./rules.js";

// Reuse the Toolkit's production-build Chromium navigation harness.
export async function checkIntake({ visit, click, evaluate, width }) {
  await visit("/");
  await click('main a[href="intake-checker/"]', "/intake-checker/");
  await evaluate("document.querySelector('#intakeForm button[type=submit]').click()");
  assert(await evaluate("document.getElementById('intakeMessage').textContent.includes('Paste') && document.getElementById('intakeResults').hidden"));
  const input = "**PERSONAL INFORMATION**\n**First Name:**Alex\n**Middle Name:***Not provided*\n**Last Name:**Rivera\n**MEDICAL INFORMATION**\n#### Clinic 1\n**Clinic Name:**North\n#### Clinic 2\n**Clinic Name:**South\n#### Medication 1\n**Medication Name:**Example\n**WORK HISTORY**\n#### Most Recent Job\n**Employer:**Example Company\n**Notes:**<img src=x onerror=alert(1)>";
  const storageBefore = await evaluate("JSON.stringify([localStorage, sessionStorage])");
  await evaluate(`window.intakeRequests = 0; window.fetch = () => { window.intakeRequests++; throw new Error('No intake requests allowed'); };
    document.getElementById('intakeText').value = ${JSON.stringify(input)};
    document.querySelector('#intakeForm button[type=submit]').click()`);
  assert.equal(await evaluate("document.getElementById('resultsTitle').textContent"), "Intake Parsed Successfully");
  const summary = await evaluate("document.getElementById('intakeSummary').textContent");
  for (const expected of ["Sections Found3", "ClientAlex Rivera", "Medical Providers2", "Medications1", "Work History Entries1"]) assert(summary.includes(expected), expected);
  await evaluate("document.querySelector('#intakeDebug summary').click()");
  const parsed = await evaluate("JSON.parse(document.getElementById('parsedIntake').textContent)");
  assert.equal(parsed.sections[0].fields[1].value, null);
  assert.equal(parsed.sections[1].subsections.length, 3);
  assert(await evaluate("document.getElementById('validationIssues').textContent.includes('Email is required') && document.getElementById('validationLimits').textContent.includes('Prior-marriage')"), "Validation errors and deferred rules are visible");
  assert(await evaluate("!document.querySelector('#intakeResults img') && document.documentElement.scrollWidth <= innerWidth"), `Safe text rendering and layout at ${width}px`);
  assert.equal(await evaluate("window.intakeRequests"), 0);
  assert.equal(await evaluate("JSON.stringify([localStorage, sessionStorage])"), storageBefore);
  await evaluate("document.getElementById('intakeText').dispatchEvent(new Event('input'))");
  assert(await evaluate("document.getElementById('intakeResults').hidden && !document.getElementById('parsedIntake').textContent"), "Editing clears stale results");
  assert.equal(await evaluate("document.getElementById('validationIssues').children.length"), 0);
  const requiredFields = labels => labels.map(label => `**${label}:**No`).join("\n");
  const complete = Object.entries(intakeRules.sections).map(([title, config]) => `**${title}**\n${requiredFields(config.required)}`).join("\n") + "\n**MEDICAL PROBLEMS**\n**Problem one:**Example condition";
  await evaluate(`document.getElementById('intakeText').value = ${JSON.stringify(complete)}; document.querySelector('#intakeForm button[type=submit]').click()`);
  assert.equal(await evaluate("document.getElementById('validationSummary').textContent"), "No issues found under the active V1 rules.");
  const incompleteClinic = complete + "\n**MEDICAL PROVIDERS**\n#### Clinic 1\n" + requiredFields(intakeRules.records.providers.required) + "\n#### Clinic 2\n**Clinic Name:**Example\n**First Visit Date:**2020-01-01";
  await evaluate(`document.getElementById('intakeText').value = ${JSON.stringify(incompleteClinic)}; document.querySelector('#intakeForm button[type=submit]').click()`);
  assert(await evaluate("[...document.querySelectorAll('#validationIssues li')].every(row => row.textContent.includes('Clinic 2'))"), "Clinic 1 cannot satisfy Clinic 2 fields");
  assert(await evaluate("document.getElementById('validationIssues').textContent.includes('Last Visit Date is required when First Visit Date is provided.')"));
  assert.equal(await evaluate("window.intakeRequests"), 0);
  assert.equal(await evaluate("JSON.stringify([localStorage, sessionStorage])"), storageBefore);
  await evaluate("document.getElementById('intakeText').value = 'Unrecognized text'; document.querySelector('#intakeForm button[type=submit]').click()");
  assert.equal(await evaluate("document.getElementById('resultsTitle').textContent"), "Review Parsed Intake");
  assert(await evaluate("document.getElementById('validationReport').hidden && !document.getElementById('validationIssues').children.length && document.getElementById('intakeMessage').textContent.includes('Validation was not run')"), "Zero sections must skip validation and clear stale errors");
  const plainComplete = complete.replace(/\*\*([^*]+):\*\*/g, "$1:\n").replace(/\*\*([^*]+)\*\*/g, "$1");
  await evaluate(`document.getElementById('intakeText').value = ${JSON.stringify(plainComplete)}; document.querySelector('#intakeForm button[type=submit]').click()`);
  assert.equal(await evaluate("document.getElementById('validationSummary').textContent"), "No issues found under the active V1 rules.");
  assert(await evaluate("!document.getElementById('validationReport').hidden"), "Recognized plain text must run validation");
  await evaluate("document.getElementById('clearIntake').click()");
  assert(await evaluate("!document.getElementById('intakeText').value && document.getElementById('intakeResults').hidden && !document.getElementById('parsedIntake').textContent"));
  console.log(`PASS (${width}px): Intake home link, parsing, summary, debug, missing values, safe rendering, no storage/fetch, edit/reset, unsupported input.`);
}
