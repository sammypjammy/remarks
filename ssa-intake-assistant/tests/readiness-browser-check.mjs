import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completeSyntheticIntake } from './complete-intake.mjs';
import { parseIntake } from '../../intake-checker/parser.js';
import { createIntakeSession } from '../../intake-checker/session.js';
import { createClientData } from '../../intake-checker/client-data.js';
import { clientFilingText } from '../src/model/client-filing-text.js';

export const readinessIntake = completeSyntheticIntake()
  .replace('**First Name:** Synthetic', '**First Name:** 123')
  .replace('**Middle Name:** Synthetic', '**Middle Name:** Synthetic\n**Middle Name:** Different')
  .replace('**Currently working:** No', '**Currently working:** Yes')
  .replace('**Date of Birth:** 2000-01-01', '**Date of Birth:** 02/30/2000')
  .replace('\n## SCHOOL INFORMATION', `
Previous Spouse 1
First Name: Fictional Former
Middle Name: Middle Former
Name at Birth: Birth Former
Prior spouse died since marriage ended: Unknown
Previous Spouse 2
First Name: Fictional Former Two

## SCHOOL INFORMATION`)
  + '\n## CUSTOM\n**Unmapped question:** <img src=x onerror=alert(1)>';

export async function checkReadiness({ cdp, evaluate, visit, click, check, until, network, origin, directory }) {
  const expected = clientFilingText(createClientData(createIntakeSession(parseIntake(readinessIntake))));
  const priorOne = expected.match(/\[MARRIAGE INFORMATION \/ Previous Spouse 1\]\n([\s\S]*?)(?=\n\n|$)/)?.[1];
  const priorTwo = expected.match(/\[MARRIAGE INFORMATION \/ Previous Spouse 2\]\n([\s\S]*?)(?=\n\n|$)/)?.[1];
  assert(priorOne && priorTwo);
  assert.equal(priorOne.split('\n').length, 18);
  assert.equal(priorTwo.split('\n').length, 18);
  assert(priorOne.includes('MiddleName: Middle Former') && priorOne.includes('NameAtBirth: Birth Former'));
  assert(priorOne.includes('SocialSecurityNumber: Not provided') && priorOne.includes('PriorSpouseDiedSinceMarriageEnded: Unknown'));
  assert(priorTwo.includes('FirstName: Fictional Former Two') && priorTwo.includes('MarriageEndDate: Not provided'));
  for (const width of [1280, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await visit('/intake-checker/');
    await until(() => evaluate("PackardSettings.accountPreferencesStatus() === 'saved'"));
    const storage = await evaluate('JSON.stringify([localStorage, sessionStorage])');
    const history = await evaluate('JSON.stringify([location.href, history.state, history.length])');
    await evaluate(`window.clientWrites = 0; for (const method of ['setItem', 'removeItem', 'clear']) { const original = Storage.prototype[method]; Storage.prototype[method] = function(...args) { window.clientWrites++; return original.apply(this, args); }; } window.clientLogs = 0; for (const method of ['log','warn','error','info','debug']) console[method] = () => { window.clientLogs++; }; window.clientDb = 0; indexedDB.open = () => { window.clientDb++; throw Error('No client database'); }; window.open = () => { throw Error('No external filing page'); };`);
    await check(readinessIntake);
    assert(await evaluate("document.getElementById('continueToSsa').disabled && !document.getElementById('continueToSsa').hidden"));
    await evaluate("document.getElementById('continueToSsa').click()");
    assert(await evaluate("document.getElementById('ssaIntakeView').hidden"));
    await evaluate("document.querySelectorAll('#validationIssues .intake-reviewed').forEach(button => button.click())");
    assert(await evaluate("document.getElementById('continueToSsa').disabled && document.querySelectorAll('#reviewItems li').length > 0"));
    await evaluate("document.querySelectorAll('#reviewItems .intake-reviewed').forEach(button => button.click())");
    assert(await evaluate("!document.getElementById('continueToSsa').disabled && document.getElementById('continueToSsaStatus').hidden"));
    const reviewHtml = await evaluate("document.getElementById('intakeResults').innerHTML");
    const start = network.length;
    for (let repeat = 0; repeat < 2; repeat++) {
      await click('Continue to SSA Intake Assistant');
      await until(() => evaluate("!!document.querySelector('.ssa-client-filing')"));
      assert(await evaluate("document.querySelectorAll('.ssa-client-filing button').length === 2 && !document.querySelector('.ssa-client-filing textarea, .ssa-client-filing p, .readiness-counts, .blocked-fields, .ready-fields, .development-bridge')"));
      await click('Open client filing');
      await until(() => evaluate("!!document.getElementById('clientFilingText')"));
      assert.equal(await evaluate("document.getElementById('clientFilingText').value"), expected);
      assert(await evaluate("document.getElementById('clientFilingText').readOnly && document.activeElement.id === 'clientFilingText' && !document.querySelector('.ssa-client-filing img')"));
      assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
      assert(await evaluate("document.getElementById('clientFilingText').getBoundingClientRect().top >= document.querySelector('.ssa-client-filing button').getBoundingClientRect().bottom"));
      if (!repeat) {
        const shot = await cdp('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(directory, `synthetic-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
      await click('Back to Intake Checker');
      assert.equal(await evaluate('intakeText.value'), readinessIntake);
      assert.equal(await evaluate("document.getElementById('intakeResults').innerHTML"), reviewHtml);
      assert(await evaluate("!document.getElementById('ssaIntakeView').children.length"));
    }
    assert.equal(await evaluate('JSON.stringify([localStorage, sessionStorage])'), storage);
    assert.equal(await evaluate('JSON.stringify([location.href, history.state, history.length])'), history);
    assert.equal(await evaluate('window.clientWrites + window.clientDb + window.clientLogs'), 0);
    assert(network.slice(start).every(request => request.method === 'GET' && !request.postData && request.url === origin + '/api/auth/session'));
    await evaluate("intakeText.dispatchEvent(new Event('input'))");
    assert(await evaluate("document.getElementById('continueToSsa').hidden && !document.getElementById('ssaIntakeView').children.length"));
    await check(readinessIntake);
    assert(await evaluate("document.getElementById('continueToSsa').disabled"));
    await evaluate("document.querySelectorAll('#validationIssues .intake-reviewed, #reviewItems .intake-reviewed').forEach(button => button.click())");
    await click('Continue to SSA Intake Assistant');
    await until(() => evaluate("!!document.querySelector('.ssa-client-filing')"));
    await click('Open client filing');
    await evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    assert(await evaluate("!intakeText.value && !document.getElementById('ssaIntakeView').children.length"));
    await visit('/intake-checker/');
    assert(await evaluate("!intakeText.value && document.getElementById('continueToSsa').hidden && !document.getElementById('clientFilingText')"));
    console.log(`PASS ${width}px: gated filing preview, Back button, canonical values, review state, safe rendering, layout and memory-only lifecycle`);
  }
}
