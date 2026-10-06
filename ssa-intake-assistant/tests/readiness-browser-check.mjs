import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completeSyntheticIntake } from './complete-intake.mjs';

export const readinessIntake = completeSyntheticIntake()
  .replace('**First Name:** Synthetic', '**First Name:** 123')
  .replace('**Middle Name:** Synthetic', '**Middle Name:** Synthetic\n**Middle Name:** Different')
  .replace('**Currently working:** No', '**Currently working:** Yes')
  .replace('**Date of Birth:** 2000-01-01', '**Date of Birth:** 02/30/2000')
  + '\n## CUSTOM\n**Unmapped question:** Synthetic';

export async function checkReadiness({ cdp, evaluate, visit, click, check, until, network, origin, directory }) {
  const counts = () => evaluate("Object.fromEntries([...document.querySelectorAll('[data-count]')].map(item => [item.dataset.count, Number(item.textContent)]))");
  async function correct(id, value) {
    await evaluate(`(() => {
      const row = document.querySelector('[data-field-id="${id}"]'); row.open = true;
      const input = row.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await evaluate(`document.querySelector('[data-field-id="${id}"] button[type="submit"]').click()`);
    await until(() => evaluate(`!!document.querySelector('.ready-fields [data-field-id="${id}"]')`));
  }
  for (const width of [1280, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await visit('/intake-checker/');
    await until(() => evaluate("PackardSettings.accountPreferencesStatus() === 'saved'"));
    const storage = await evaluate('JSON.stringify([localStorage, sessionStorage])');
    const history = await evaluate('JSON.stringify([location.href, history.state, history.length])');
    await evaluate(`window.clientWrites = 0; for (const method of ['setItem', 'removeItem', 'clear']) { const original = Storage.prototype[method]; Storage.prototype[method] = function(...args) { window.clientWrites++; return original.apply(this, args); }; } window.clientLogs = 0; for (const method of ['log','warn','error','info','debug']) console[method] = () => { window.clientLogs++; }; window.clientDb = 0; indexedDB.open = () => { window.clientDb++; throw Error('No client database'); };`);
    const scopedText = 'PERSONAL INFORMATION\nFirst Name: Synthetic\nMEDICAL PROVIDERS\nClinic 1\nClinic Name: Synthetic Clinic\nUnmapped question: Synthetic answer';
    await check(scopedText); await click('Continue to SSA Intake Assistant');
    await until(() => evaluate("!!document.querySelector('.ssa-readiness')"));
    assert(await evaluate('!!document.querySelector(' + JSON.stringify('.ready-fields [data-field-id="personal.first-name"]') + ')'));
    assert(await evaluate('!!document.querySelector(' + JSON.stringify('.blocked-fields [data-field-id="providers.clinic-name@providers-1"]') + ')'));
    assert(await evaluate("document.querySelector('.parsing-issues').textContent.includes('Line 6')"));
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
    await evaluate("document.querySelector('.parsing-issues button').click()");
    assert.equal(await evaluate("intakeText.value.slice(intakeText.selectionStart, intakeText.selectionEnd)"), 'Unmapped question: Synthetic answer');
    assert.equal(await evaluate('intakeText.value'), scopedText);
    const documentText = 'Print as PDF\nIntake Form\nSynthetic Example\nGenerated on October 5, 2026 at 5:33 PM\n\nPERSONAL INFORMATION\nFirst Name:\nSynthetic\nDISABILITY INFORMATION\nFiled for disability in the past:\nNo\nOnset date of disability:\n2000-01-01';
    await check(documentText); await click('Continue to SSA Intake Assistant');
    await until(() => evaluate("!!document.querySelector('.ssa-readiness')"));
    assert(await evaluate("!document.querySelector('.parsing-issues')"));
    assert(await evaluate('!!document.querySelector(' + JSON.stringify('.ready-fields [data-field-id="disability.onset-date-of-disability"]') + ')'));
    assert(await evaluate("[...document.querySelectorAll('.blocked-field')].some(row => row.textContent.includes('Filed for disability in the past') && row.textContent.includes('Not mapped yet') && row.textContent.includes('No intake correction is required'))"));
    await click('Back to Intake Checker');
    assert.equal(await evaluate('intakeText.value'), documentText);
    const normalizedIntake = completeSyntheticIntake()
      .replace('**First Name:** Synthetic', '**First Name:** sYNTHETIC.')
      .replace('**Phone Number:** 202-555-0142', '**Phone Number:** (202) 555.0142');
    await check(normalizedIntake);
    assert(await evaluate("document.getElementById('intakeNormalizations').textContent.includes('Phone Number: 202-555-0142') && document.getElementById('intakeNormalizations').textContent.includes('First Name: Synthetic')"));
    assert.equal(await evaluate("document.getElementById('intakeText').value"), normalizedIntake);
    await click('Continue to SSA Intake Assistant');
    await until(() => evaluate("!!document.querySelector('.ssa-readiness')"));
    assert.equal((await counts()).blocked, 0);
    assert(await evaluate("document.querySelector('.ready-fields [data-field-id=\"personal.phone-number\"]').textContent.includes('202-555-0142')"));
    await click('Back to Intake Checker');
    await check(readinessIntake);
    await evaluate("document.querySelector('#reviewItems .intake-reviewed').click()");
    assert(await evaluate("[...document.querySelectorAll('#validationIssues li[data-severity=error]')].every(row => !row.querySelector('.intake-reviewed'))"));
    const reviewHtml = await evaluate("document.getElementById('intakeResults').innerHTML");
    const start = network.length;
    await click('Continue to SSA Intake Assistant');
    await until(() => evaluate("!!document.querySelector('.ssa-readiness')"));
    assert.deepEqual(await counts(), { total: 121, ready: 117, blocked: 4, missing: 1, conflicts: 1 });
    assert(await evaluate("!document.querySelector('#ssaIntakeView input[type=checkbox]') && !document.querySelector('#ssaIntakeView .confirm-control')"));
    assert(await evaluate("document.querySelector('.ready-fields [data-field-id=\"personal.last-name\"]').textContent.includes('Synthetic')"));
    assert(await evaluate("document.querySelector('[data-field-id=\"personal.first-name\"]').textContent.includes('must contain letters')"));
    assert(await evaluate("document.querySelector('[data-field-id=\"birth.date-of-birth\"]').textContent.includes('No valid calendar date')"));
    assert(await evaluate("!document.querySelector('[data-field-id=\"personal.middle-name\"] form') && !document.querySelector('[data-field-id^=\"unsupported.\"] form')"));
    await click('Back to Intake Checker');
    assert.equal(await evaluate("document.getElementById('intakeText').value"), readinessIntake);
    assert.equal(await evaluate("document.getElementById('intakeResults').innerHTML"), reviewHtml);
    await click('Continue to SSA Intake Assistant');
    await evaluate("(() => { const row = document.querySelector('[data-field-id=\"birth.date-of-birth\"]'); row.open = true; const input = row.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2000-01-02'); input.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await correct('personal.first-name', 'Edited');
    assert.equal((await counts()).ready, 118);
    assert.equal(await evaluate("document.getElementById('correct-birth.date-of-birth').value"), '2000-01-02', 'unapplied draft survives another correction');
    await correct('birth.date-of-birth', '2000-01-02');
    assert.deepEqual(await counts(), { total: 121, ready: 119, blocked: 2, missing: 0, conflicts: 1 });
    assert(await evaluate("document.querySelector('.ready-fields [data-field-id=\"personal.first-name\"]').textContent.includes('Employee-entered')"));
    await click('Back to Intake Checker');
    assert.equal(await evaluate("document.querySelectorAll('#reviewItems li').length"), 0, 'unrelated dismissal retained after correction');
    assert(await evaluate("document.getElementById('intakeCorrections').textContent.includes('Edited') && document.querySelector('.review-copy').textContent.includes('Edited')"));
    assert.equal(await evaluate("document.getElementById('intakeText').value"), readinessIntake, 'original provenance is intact');
    await click('Continue to SSA Intake Assistant');
    assert.equal((await counts()).ready, 119);
    await evaluate("document.querySelector('[data-field-id=\"personal.middle-name\"]').open = true; document.querySelector('[data-field-id=\"personal.middle-name\"] button').click()");
    assert.equal(await evaluate("document.getElementById('intakeText').value.slice(document.getElementById('intakeText').selectionStart, document.getElementById('intakeText').selectionEnd)"), '**Middle Name:** Synthetic');
    await click('Continue to SSA Intake Assistant');
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(directory, `synthetic-${width}.png`), Buffer.from(shot.data, 'base64'));
    assert.equal(await evaluate('JSON.stringify([localStorage, sessionStorage])'), storage);
    assert.equal(await evaluate('JSON.stringify([location.href, history.state, history.length])'), history);
    assert.equal(await evaluate('window.clientWrites + window.clientDb + window.clientLogs'), 0);
    assert(network.slice(start).every(request => request.method === 'GET' && !request.postData && request.url === origin + '/api/auth/session'));
    await click('Back to Intake Checker');
    await evaluate("document.getElementById('intakeText').value += '\\n'; document.getElementById('intakeText').dispatchEvent(new Event('input'))");
    assert(await evaluate("document.getElementById('continueToSsa').hidden && !document.getElementById('ssaIntakeView').children.length && !document.getElementById('intakeCorrections').children.length"));
    await check(readinessIntake); await click('Continue to SSA Intake Assistant');
    await until(() => evaluate("!!document.querySelector('.ssa-readiness')"));
    assert.equal((await counts()).blocked, 4, 'new source session clears prior corrections');
    await evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    assert(await evaluate("!document.getElementById('intakeText').value && !document.getElementById('ssaIntakeView').children.length"));
    await visit('/intake-checker/');
    assert(await evaluate("!document.getElementById('intakeText').value && document.getElementById('continueToSsa').hidden"));
    console.log(`PASS ${width}px: complete readiness profile, no confirmations, corrections, Checker consistency, Back, provenance, layout and memory-only lifecycle`);
  }
}
