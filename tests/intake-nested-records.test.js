import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake } from '../intake-checker/parser.js';
import { validateIntake } from '../intake-checker/validation.js';
import { intakeRules } from '../intake-checker/rules.js';
import { syntheticValue } from './synthetic-intake-values.js';
import { issueSource } from '../intake-checker/source-location.js';
import { createIntakeSession } from '../intake-checker/session.js';
import { fromIntakeChecker } from '../ssa-intake-assistant/src/model/from-intake-checker.js';
const now = new Date(2031, 8, 16);
const report = text => validateIntake(parseIntake(text), intakeRules, { now });
const fields = labels => labels.map(label => label + ': ' + syntheticValue(label)).join('\n');
for (const [key, heading] of [['jobs', 'Job 1'], ['providers', 'Clinic 1'], ['medications', 'Medication 1']]) {
  test(key + ': recognized parent does not hide child or grandchild; requirements remain record-local', () => {
    const rule = intakeRules.records[key];
    const extra = key === 'providers' ? '\nClinic Name: Synthetic Clinic' : '';
    const text = rule.section + '\n#### ' + heading + '\n' + fields(rule.required) + extra
      + '\n##### ' + heading + '\n###### ' + heading;
    const parsed = parseIntake(text);
    const before = JSON.stringify(parsed);
    const issues = validateIntake(parsed, intakeRules, { now }).issues.filter(issue => issue.section === rule.section);
    const expected = rule.required.length + (key === 'providers' ? 1 : 0);
    for (const location of ['/0/0/0', '/0/0/0/0']) {
      const own = issues.filter(issue => issue.location === location);
      assert.equal(own.length, expected);
      assert(own.every(issue => issue.severity === 'error'));
      const range = issueSource(parsed, own[0]);
      assert(text.slice(range.start, range.end).endsWith(heading));
    }
    assert.equal(issues.length, expected * 2);
    assert.equal(JSON.stringify(parsed), before);
    const profile = fromIntakeChecker(createIntakeSession(parsed));
    const child = profile.fields.filter(field => field.recordId === key + '-2');
    assert(child.length);
    assert(child.every(field => field.readiness === 'blocked'));
    assert(child.every(field => field.validation.issues.every(issue => issue.location === '/0/0/0')));
  });
}

test('nested job current-year address requirements apply only to that job', () => {
  const text = 'WORK HISTORY\n#### Job 1\n' + fields(intakeRules.records.jobs.required)
    + '\n##### Job 2\n' + fields(intakeRules.records.jobs.required).replace('End Date: 2000-01-01', 'End Date: 2031-01-01');
  const issues = report(text).issues.filter(issue => issue.section === 'WORK HISTORY');
  assert.deepEqual(issues.map(issue => issue.field), ['Address', 'City', 'State', 'Zipcode']);
  assert(issues.every(issue => issue.location === '/0/0/0'));
});

test('nested provider first-visit condition and date-order checks apply independently', () => {
  const base = 'MEDICAL PROVIDERS\n#### Clinic 1\n' + fields(intakeRules.records.providers.required) + '\nClinic Name: Synthetic Clinic\n##### Clinic 2\n' + fields(intakeRules.records.providers.required) + '\nClinic Name: Synthetic Clinic\nFirst Visit Date: 2000-02-01';
  const missing = report(base).issues.filter(issue => issue.section === 'MEDICAL PROVIDERS');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].field, 'Last Visit Date');
  assert.equal(missing[0].location, '/0/0/0');
  const reversed = report(base + '\nLast Visit Date: 2000-01-01').issues.filter(issue => issue.section === 'MEDICAL PROVIDERS');
  assert.deepEqual(reversed.map(issue => issue.field), ['First Visit Date', 'Last Visit Date']);
  assert(reversed.every(issue => issue.severity === 'error'));
  assert.match(reversed[1].message, /on or after/);
});

test('field-recognized nested records are checked and unknown descendants remain review warnings', () => {
  const text = 'MEDICATIONS\n#### Medication 1\nMedication Name: Synthetic\n##### Custom record\nMedication Name: Not provided\n###### Unknown details\n**Synthetic field:** test';
  const issues = report(text).issues.filter(issue => issue.section === 'MEDICATIONS');
  assert(issues.some(issue => issue.location === '/0/0/0' && issue.field === 'Medication Name' && issue.severity === 'error'));
  assert(issues.some(issue => issue.location === '/0/0/0/0' && issue.severity === 'warning'));
});

test('nested children stay optional and have distinct profile identities', () => {
  const text = 'CHILDREN INFORMATION\n#### Child A\nFirst Name: Synthetic\n##### Child B\nFirst Name: Synthetic';
  assert.equal(report(text).issues.filter(issue => issue.section === 'CHILDREN INFORMATION').length, 0);
  const children = fromIntakeChecker(createIntakeSession(parseIntake(text))).fields.filter(field => field.definitionId === 'children.first-name');
  assert.equal(children.length, 2);
  assert.notEqual(children[0].recordId, children[1].recordId);
});

test('nested marriage details retain the existing Type of Marriage requirement', () => {
  const text = 'MARRIAGE INFORMATION\nMarital Status: Separated\n#### Marriage group\n##### Previous Spouse\nFirst Name: Synthetic';
  const issues = report(text).issues.filter(issue => issue.section === 'MARRIAGE INFORMATION');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, 'Type of Marriage');
  assert.equal(issues[0].location, '/0/0/0');
});
