import assert from 'node:assert/strict';

export async function checkValidationReviewed({ evaluate, visit, complete, width }) {
  // Synthetic records: two independent precision warnings and non-dismissable missing/format errors.
  const source = complete + '\n**MEDICAL PROVIDERS**\n#### Clinic 1\n**Phone Number:**Not provided\n**First Visit Date:**01/2000\n**Last Visit Date:**01/2000\n#### Clinic 2\n**Phone Number:**123\n**First Visit Date:**01/2000\n**Last Visit Date:**01/2000';
  const check = value => evaluate(`document.getElementById('intakeText').value = ${JSON.stringify(value)}; document.querySelector('#intakeForm button[type=submit]').click()`);
  const count = () => evaluate("document.querySelectorAll('#validationIssues li').length");
  const persistenceBefore = await evaluate('JSON.stringify([localStorage, sessionStorage, document.cookie, location.href])');
  await check(source);
  const original = await count();
  assert(original > 2);
  assert(await evaluate("[...document.querySelectorAll('#validationIssues li[data-severity=error]')].every(row => !row.querySelector('.intake-reviewed'))"));
  assert.equal(await evaluate("document.querySelectorAll('#validationIssues li[data-severity=warning] .intake-reviewed').length"), 2);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#validationIssues li[data-severity=warning]')).backgroundColor"), 'rgb(255, 250, 235)');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#validationIssues li[data-severity=error]')).backgroundColor"), 'rgb(255, 241, 241)');
  await evaluate("document.querySelector('button[aria-label=\"Find in Intake: MEDICAL PROVIDERS / Clinic 1 / Phone Number\"]').click()");
  assert.equal(await evaluate('intakeText.value.slice(intakeText.selectionStart, intakeText.selectionEnd)'), '**Phone Number:**Not provided');
  await evaluate("document.querySelector('#validationIssues .intake-reviewed').click()");
  assert.equal(await count(), original - 1);
  assert(await evaluate("document.querySelector('#validationIssues li[data-severity=warning]').textContent.includes('Clinic 2')"));
  await evaluate("document.querySelector('#validationIssues .intake-reviewed').click()");
  assert.equal(await count(), original - 2);
  assert(await evaluate("document.getElementById('validationSummary').textContent.includes('0 warnings') && document.getElementById('validationSummary').dataset.success === 'false'"));
  assert.equal(await evaluate('intakeText.value'), source);
  await check(source);
  assert.equal(await count(), original, 'Rechecking restores warnings');
  await evaluate("document.getElementById('clearIntake').click()");
  assert.equal(await count(), 0);
  await check(complete);
  assert.equal(await count(), 0);
  assert.equal(await evaluate("document.getElementById('validationSummary').dataset.success"), 'true');
  await check('MEDICATIONS\n#### Medication 1\nMedication Name: Synthetic\n##### Medication 2');
  assert(await evaluate("[...document.querySelectorAll('#validationIssues li[data-severity=error]')].some(row => row.textContent.includes('Medication 2') && row.textContent.includes('Medication Name'))"));
  await evaluate('document.querySelector(' + JSON.stringify('button[aria-label="Find in Intake: MEDICATIONS / Medication 2 / Medication Name"]') + ').click()');
  assert.equal(await evaluate('intakeText.value.slice(intakeText.selectionStart, intakeText.selectionEnd)'), '##### Medication 2');
  await check('PERSONAL INFORMATION\nFirst Name: Synthetic\nUnmapped question: Synthetic answer');
  assert(await evaluate("[...document.querySelectorAll('#validationIssues li[data-severity=error]')].some(row => row.textContent.includes('PARSING') && !row.querySelector('.intake-reviewed'))"));
  await evaluate('document.querySelector(' + JSON.stringify('button[aria-label="Find in Intake: PARSING"]') + ').click()');
  assert.equal(await evaluate('intakeText.value.slice(intakeText.selectionStart, intakeText.selectionEnd)'), 'Unmapped question: Synthetic answer');
  await check('MEDICAL PROVIDERS\nClinic 1\nFirst Visit Date: 2001-01-01\nLast Visit Date: 2000-01-01');
  for (const label of ['First Visit Date', 'Last Visit Date']) {
    assert(await evaluate('([...document.querySelectorAll("#validationIssues li[data-severity=error]")].some(row => row.querySelector("strong").textContent.endsWith(' + JSON.stringify(label) + ') && row.textContent.includes("must be on or") && !row.querySelector(".intake-reviewed")))'));
  }
  const duplicateText = 'PERSONAL INFORMATION\nFirst Name: Synthetic\nFirst Name: Different';
  await check(duplicateText);
  assert(await evaluate("(() => { const row = [...document.querySelectorAll('#validationIssues li')].find(row => row.textContent.includes('conflicting answers')); return row.dataset.severity === 'error' && !row.querySelector('.intake-reviewed') && row.querySelectorAll('.intake-locate').length === 2; })()"));
  for (const [index, expected] of [[1, 'First Name: Synthetic'], [2, 'First Name: Different']]) {
    await evaluate('document.querySelector(' + JSON.stringify('button[aria-label="Find in Intake: PERSONAL INFORMATION / First Name / occurrence ' + index + '"]') + ').click()');
    assert.equal(await evaluate('intakeText.value.slice(intakeText.selectionStart, intakeText.selectionEnd)'), expected);
  }
  await check(duplicateText.replace('Different', 'Synthetic'));
  assert(await evaluate("![...document.querySelectorAll('#validationIssues li')].some(row => row.textContent.includes('conflicting answers'))"));
  assert.equal(await evaluate('JSON.stringify([localStorage, sessionStorage, document.cookie, location.href])'), persistenceBefore);
  assert.equal(await evaluate('window.intakeRequests'), 0);
  await visit('/'); await visit('/intake-checker/');
  assert(await evaluate("!intakeText.value && document.getElementById('intakeResults').hidden"));
  console.log(`PASS (${width}px): red errors cannot be dismissed; yellow warnings can, independent source locations, reset and no persistence.`);
}
