import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mappings, planPractice, fillPractice, schemaVersion } from '../ssa-intake-assistant/extension-dev/mapping.js';
import { syntheticProfile } from '../ssa-intake-assistant/extension-dev/synthetic.js';
import { PROFILE_SCHEMA_VERSION, fieldDefinitions } from '../ssa-intake-assistant/src/model/intake-contract.js';
import { parseIntake } from '../intake-checker/parser.js';
import { createIntakeSession } from '../intake-checker/session.js';
import { fromIntakeChecker } from '../ssa-intake-assistant/src/model/from-intake-checker.js';
import { completeSyntheticIntake } from '../ssa-intake-assistant/tests/complete-intake.mjs';

test('practice mapping references exact current contract IDs without inventing date-work-stopped', () => {
  assert.equal(schemaVersion, PROFILE_SCHEMA_VERSION);
  for (const m of mappings.filter(m => m.definitionId)) assert(fieldDefinitions.some(d => d.id === m.definitionId && d.dataType === m.type && !d.record));
  const plan = planPractice(fromIntakeChecker(createIntakeSession(parseIntake(completeSyntheticIntake()))));
  assert.equal(plan.filter(item => item.status === 'ready').length, 32);
  assert.equal(plan.find(item => item.target === 'work-stopped').status, 'pause');
});
test('synthetic practice fills thirty answers and pauses on missing, partial and unsupported answers', () => {
  const p = syntheticProfile(), before = JSON.stringify(p), plan = planPractice(p);
  assert.equal(plan.filter(item => item.status === 'ready').length, 30);
  assert.equal(plan.find(item => item.target === 'birth-city').value, 'Example City');
  assert.equal(plan.find(item => item.target === 'mailing-city').value, 'Sample City');
  assert.equal(plan.find(item => item.target === 'physical-city').value, 'Another City');
  assert.equal(plan.find(item => item.target === 'ssn').value, '000-12-3456');
  assert.equal(plan.find(item => item.target === 'alternate-phone').value, '202-555-0143');
  assert.equal(plan.find(item => item.target === 'secondary-phone').value, '202-555-0144');
  assert.equal(plan.find(item => item.target === 'speak-english').value, true);
  assert.equal(plan.find(item => item.target === 'read-english').value, false);
  assert.equal(plan.find(item => item.target === 'onset').value, '2020-03');
  assert.equal(plan.find(item => item.target === 'last-worked').status, 'pause');
  assert.equal(JSON.stringify(p), before);
});
test('boolean practice answers fill only exact empty Yes/No selects and preserve employee choices', () => {
  const select = { tagName:'SELECT', value:'', disabled:false,
    options:[{value:''},{value:'yes'},{value:'no'}] };
  const root = { dataset:{practice:'packard-synthetic-v1'}, querySelectorAll:selector =>
    selector.includes('read-english') ? [select] : [] };
  assert.equal(fillPractice(syntheticProfile(), root).find(item => item.target === 'read-english').status, 'filled');
  assert.equal(select.value, 'no');
  select.value = 'yes';
  assert.equal(fillPractice(syntheticProfile(), root).find(item => item.target === 'read-english').status, 'pause');
  assert.equal(select.value, 'yes');
  select.value = ''; select.options[2].value = 'other';
  assert.equal(fillPractice(syntheticProfile(), root).find(item => item.target === 'read-english').status, 'pause');
});
test('ignoring a Checker error hides a task but cannot authorize filling an invalid answer', () => {
  const session = createIntakeSession(parseIntake('PERSONAL INFORMATION\nFirst Name: 123'));
  session.report.issues.forEach(session.validationState.review);
  assert.equal(planPractice(fromIntakeChecker(session))[0].status, 'pause');
});
test('unknown schema, duplicates, wrong types, repeated subjects and unresolved fields fail closed', () => {
  for (const mutate of [p => p.schemaVersion = '0', p => p.schema = 'other', p => p.fields = null]) {
    const p = syntheticProfile(); mutate(p); assert(planPractice(p).every(item => item.status === 'pause'));
  }
  for (const mutate of [p => p.fields.push({...p.fields[0]}), p => p.fields[0].recordId = 'person-2', p => p.fields[0].value = true,
    p => p.fields[0].dataType = 'boolean', p => p.fields[0].readiness = 'blocked', p => p.fields[0].blockingReasons = [{code:'conflict'}]]) {
    const p = syntheticProfile(); mutate(p); assert.equal(planPractice(p)[0].status, 'pause');
  }
});
test('explicit fill preserves employee entries and refuses changed targets', () => {
  const input = { tagName:'INPUT', type:'text', value:'Employee entry' };
  const root = { dataset:{practice:'packard-synthetic-v1'}, querySelectorAll: () => [input] };
  assert(fillPractice(syntheticProfile(), root).every(item => item.status === 'pause'));
  assert.equal(input.value, 'Employee entry');
  input.value = ''; input.disabled = true;
  assert(fillPractice(syntheticProfile(), root).every(item => item.status === 'pause'));
  root.querySelectorAll = () => [input, input];
  assert(fillPractice(syntheticProfile(), root).every(item => item.status === 'pause'));
  root.dataset.practice = 'other'; assert.deepEqual(fillPractice(syntheticProfile(), root), []);
});
test('Chrome practice package accepts only Toolkit messaging with no host, background or storage permissions', async () => {
  const base = new URL('../ssa-intake-assistant/extension-dev/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  for (const key of ['permissions','host_permissions','content_scripts','background','web_accessible_resources','optional_permissions','optional_host_permissions']) assert.equal(manifest[key], undefined);
  assert.deepEqual(manifest.externally_connectable, {matches:['http://127.0.0.1/*','http://localhost/*','https://packardtoolkit.vercel.app/*']});
  for (const name of ['practice.js','mapping.js','synthetic.js']) {
    const source = await readFile(new URL(name, base), 'utf8');
    assert(!/\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|console|postMessage)\b/.test(source));
  }
});
