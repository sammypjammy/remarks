import assert from "node:assert/strict";

export async function checkValidationReviewed({ evaluate, visit, complete, width }) {
  // Synthetic duplicate records verify that labels are never used as dismissal IDs.
  const source = complete + "\n**MEDICAL PROVIDERS**\n#### Clinic 1\n**Phone Number:**Not provided\n#### Clinic 2\n**Phone Number:**Not provided\n**Next Visit Date:**invalid";
  const check = async value => evaluate(`document.getElementById('intakeText').value = ${JSON.stringify(value)}; document.querySelector('#intakeForm button[type=submit]').click()`);
  const count = () => evaluate("document.querySelectorAll('#validationIssues li').length");
  const persistenceBefore = await evaluate("JSON.stringify([localStorage, sessionStorage, document.cookie, location.href])");
  await check(source);
  const originalCount = await count();
  assert(originalCount > 2);
  assert(await evaluate("[...document.querySelectorAll('#validationIssues li')].every(row => row.querySelectorAll('.intake-reviewed').length === 1)"));
  const reviewBefore = await evaluate("document.getElementById('intakeReview').innerHTML");
  // The chosen issue and surviving issue have the same field label in different records.
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('#validationIssues li')].find(row => row.querySelector('.intake-locate')?.getAttribute('aria-label') === 'Find in Intake: MEDICAL PROVIDERS / Clinic 1 / Phone Number');
    row.querySelector('.intake-locate').click();
  })()`);
  assert.equal(await evaluate("document.getElementById('intakeText').value.slice(intakeText.selectionStart, intakeText.selectionEnd)"), "**Phone Number:**Not provided");
  await evaluate(`document.querySelector('button[aria-label="Find in Intake: MEDICAL PROVIDERS / Clinic 1 / Phone Number"]').closest('li').querySelector('.intake-reviewed').click()`);
  assert.equal(await count(), originalCount - 1);
  assert(await evaluate(`document.getElementById('validationSummary').textContent.startsWith('${originalCount - 1} issues requiring attention')`));
  assert(await evaluate("!document.querySelector('button[aria-label=\"Find in Intake: MEDICAL PROVIDERS / Clinic 1 / Phone Number\"]') && !!document.querySelector('button[aria-label=\"Find in Intake: MEDICAL PROVIDERS / Clinic 2 / Phone Number\"]')"));
  await evaluate(`document.querySelector('button[aria-label="Find in Intake: MEDICAL PROVIDERS / Clinic 2 / Phone Number"]').click()`);
  assert(await evaluate(`intakeText.selectionStart > intakeText.value.indexOf('Clinic 2') && intakeText.value.slice(intakeText.selectionStart, intakeText.selectionEnd) === '**Phone Number:**Not provided'`));
  assert.equal(await evaluate("document.getElementById('intakeReview').innerHTML"), reviewBefore);
  assert.equal(await evaluate("document.getElementById('intakeText').value"), source);
  // Leave only the warning to verify per-severity counts, then acknowledge it too.
  await evaluate("document.querySelectorAll('#validationIssues li[data-severity=error] .intake-reviewed').forEach(button => button.click())");
  assert.equal(await count(), 1);
  assert.equal(await evaluate("document.getElementById('validationSummary').textContent"), "1 issue requiring attention · 0 errors · 1 warning");
  await evaluate("document.querySelector('#validationIssues .intake-reviewed').click()");
  assert.equal(await count(), 0);
  assert.equal(await evaluate("document.getElementById('validationSummary').textContent"), "All validation issues reviewed");
  assert.equal(await evaluate("document.getElementById('validationSummary').dataset.success"), "false");
  assert(await evaluate("document.activeElement === document.getElementById('validationSummary')"), 'Last dismissal preserves keyboard focus');
  await evaluate("document.querySelector('#intakeForm button[type=submit]').click()");
  assert.equal(await count(), originalCount, 'Checking the same intake resets all acknowledgements');
  await evaluate("document.querySelector('#validationIssues .intake-reviewed').click(); document.getElementById('clearIntake').click()");
  assert.equal(await count(), 0);
  assert(await evaluate("!intakeText.value && document.getElementById('intakeResults').hidden"));
  await check(source);
  assert.equal(await count(), originalCount, 'Clear discards acknowledgements');
  await evaluate("document.querySelector('#validationIssues .intake-reviewed').click()");
  await check(complete);
  assert.equal(await count(), 0);
  assert.equal(await evaluate("document.getElementById('validationSummary').textContent"), "No issues found under the active V1 rules.");
  assert.equal(await evaluate("document.getElementById('validationSummary').dataset.success"), "true");
  await check(source);
  assert.equal(await count(), originalCount, 'A new intake creates fresh state');
  await evaluate("document.querySelectorAll('#validationIssues .intake-reviewed').forEach(button => button.click())");
  assert.equal(await evaluate("JSON.stringify([localStorage, sessionStorage, document.cookie, location.href])"), persistenceBefore);
  assert.equal(await evaluate("window.intakeRequests"), 0);
  await visit("/");
  await visit("/intake-checker/");
  assert(await evaluate("!intakeText.value && document.getElementById('intakeResults').hidden && !document.querySelector('#validationIssues li')"));
  await check(source);
  assert.equal(await count(), originalCount, 'Navigating away discards intake and acknowledgements');
  console.log(`PASS (${width}px): Validation Reviewed actions, repeated records, live counts, all-reviewed versus success, Find in Intake, reset/navigation and no persistence.`);
}
