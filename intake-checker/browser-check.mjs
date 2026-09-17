import assert from "node:assert/strict";
import { checkReview } from "./review-browser-check.mjs";
import { checkValidationReviewed } from "./validation-reviewed-browser-check.mjs";
// All fixtures are synthetic and were not copied from real clients or intakes.
import { intakeRules } from "./rules.js";

// Reuse the Toolkit's production-build Chromium navigation harness.
export async function checkIntake({ visit, click, evaluate, width, capture }) {
  await visit("/");
  assert(await evaluate("![...document.querySelectorAll('a[href]')].some(a => /\\/(fax-sender|intake-checker)(\\/|$)/.test(new URL(a.href).pathname))"), "Home must not expose unreleased tools");
  await visit("/intake-checker/");
  assert(await evaluate(`(() => {
    const left = document.querySelector('.intake-input').getBoundingClientRect();
    const right = document.querySelector('.intake-output').getBoundingClientRect();
    return innerWidth > 1080 ? right.left >= left.right && Math.abs(right.top-left.top) < 2 : right.top >= left.bottom;
  })()`), "Desktop columns / mobile stacking");
  await evaluate("document.querySelector('#intakeForm button[type=submit]').click()");
  assert(await evaluate("document.getElementById('intakeMessage').textContent.includes('Paste') && document.getElementById('intakeResults').hidden"));
  const input = "**PERSONAL INFORMATION**\n**First Name:**Alex\n**Middle Name:***Not provided*\n**Last Name:**Rivera\n**MEDICAL INFORMATION**\n#### Clinic 1\n**Clinic Name:**North\n#### Clinic 2\n**Clinic Name:**South\n#### Medication 1\n**Medication Name:**Example\n**WORK HISTORY**\n#### Most Recent Job\n**Employer:**Example Company\n**Notes:**<img src=x onerror=alert(1)>";
  const storageBefore = await evaluate("JSON.stringify([localStorage, sessionStorage])");
  await evaluate(`window.intakeRequests = 0; window.fetch = () => { window.intakeRequests++; throw new Error('No intake requests allowed'); };
    document.getElementById('intakeText').value = ${JSON.stringify(input)};
    document.querySelector('#intakeForm button[type=submit]').click()`);
  assert.equal(await evaluate("document.querySelector('#intakeResults h2').textContent"), "Review");
  assert(await evaluate("!document.getElementById('resultsTitle') && !document.getElementById('intakeSummary') && !document.body.textContent.includes('Review Parsed Intake')"));
  assert(await evaluate("!document.getElementById('intakeDebug') && !document.getElementById('parsedIntake')"), "Debug UI must be removed");
  assert(await evaluate("document.getElementById('validationIssues').textContent.includes('Email is required') && !document.getElementById('validationLimits') && !document.getElementById('validationReport').textContent.includes('Prior-marriage')"), "Validation errors remain visible without developer notes");
  assert(await evaluate("!document.querySelector('#intakeResults img') && document.documentElement.scrollWidth <= innerWidth"), `Safe text rendering and layout at ${width}px`);
  assert.equal(await evaluate("window.intakeRequests"), 0);
  assert.equal(await evaluate("JSON.stringify([localStorage, sessionStorage])"), storageBefore);
  await evaluate("document.getElementById('intakeText').dispatchEvent(new Event('input'))");
  assert(await evaluate("document.getElementById('intakeResults').hidden"), "Editing clears stale results");
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
  assert(await evaluate("!document.body.textContent.includes('Review Parsed Intake')"));
  assert(await evaluate("document.getElementById('intakeReview').hidden && document.getElementById('validationReport').hidden && !document.getElementById('validationIssues').children.length && document.getElementById('intakeMessage').textContent.includes('Validation was not run')"), "Zero sections must skip validation and clear stale errors");
  const plainComplete = complete.replace(/\*\*([^*]+):\*\*/g, "$1:\n").replace(/\*\*([^*]+)\*\*/g, "$1");
  await evaluate(`document.getElementById('intakeText').value = ${JSON.stringify(plainComplete)}; document.querySelector('#intakeForm button[type=submit]').click()`);
  assert.equal(await evaluate("document.getElementById('validationSummary').textContent"), "No issues found under the active V1 rules.");
  assert(await evaluate("!document.getElementById('validationReport').hidden"), "Recognized plain text must run validation");
  for (const markdown of [false, true]) {
    const source = ["PERSONAL INFORMATION", "First Name:", "Synthetic", "Email:", "Not provided", "Notes:", ...Array(80).fill("Synthetic continuation line"),
      "MEDICAL PROVIDERS", "Clinic 1", "Phone Number:", "Example", "Clinic 2", "Phone Number:", "Not provided",
      "MARRIAGE INFORMATION", "Marital Status:", "Married", "Current Spouse", "First Name:", "Not provided"].map(line => {
        if (!markdown) return line;
        if (["PERSONAL INFORMATION", "MEDICAL PROVIDERS", "MARRIAGE INFORMATION"].includes(line)) return `**${line}**`;
        if (["Clinic 1", "Clinic 2", "Current Spouse"].includes(line)) return `#### ${line}`;
        return line.endsWith(":") ? `**${line}**` : line;
      }).join("\n");
    await evaluate(`document.getElementById('intakeText').value = ${JSON.stringify(source)}; document.querySelector('#intakeForm button[type=submit]').click()`);
    for (const [label, field] of [["PERSONAL INFORMATION / Email", "Email"], ["MEDICAL PROVIDERS / Clinic 2 / Phone Number", "Phone Number"], ["MARRIAGE INFORMATION / Current Spouse / First Name", "First Name"]]) {
      const selection = await evaluate(`(() => {
        const button = [...document.querySelectorAll('.intake-locate')].find(button => button.getAttribute('aria-label') === ${JSON.stringify("Find in Intake: " + label)});
        if (!button) throw new Error('Missing locate action'); button.click();
        const input = document.getElementById('intakeText');
        return { text: input.value.slice(input.selectionStart, input.selectionEnd), start: input.selectionStart, focus: document.activeElement === input, scroll: input.scrollTop, value: input.value };
      })()`);
      assert.equal(selection.text, `${markdown ? `**${field}:**` : `${field}:`}\nNot provided`);
      assert(selection.focus);
      assert.equal(selection.value, source);
      if (label.includes("Clinic 2")) { assert(selection.start > source.indexOf("Clinic 2")); assert(selection.scroll > 0); }
      if (label.includes("Current Spouse")) assert(selection.start > source.indexOf("Current Spouse"));
    }
    assert(await evaluate("![...document.querySelectorAll('.intake-locate')].some(button => button.getAttribute('aria-label').includes('BIRTH INFORMATION'))"), "Absent sections have no broken locate action");
  }
  assert.equal(await evaluate("window.intakeRequests"), 0);
  assert.equal(await evaluate("JSON.stringify([localStorage, sessionStorage])"), storageBefore);
  await evaluate("document.getElementById('clearIntake').click()");
  assert(await evaluate("document.getElementById('intakeText').selectionStart === 0 && document.getElementById('intakeText').selectionEnd === 0 && !document.querySelector('.intake-locate')"), "Reset clears selections and locate state");
  assert(await evaluate("!document.getElementById('intakeText').value && document.getElementById('intakeResults').hidden"));
  await checkReview({ evaluate, capture, width });
  await checkValidationReviewed({ evaluate, visit, complete, width });
  console.log(`PASS (${width}px): Intake direct route, hidden home entry, parsing, summary, locate actions, missing values, safe rendering, no storage/fetch, edit/reset, unsupported input.`);
}
