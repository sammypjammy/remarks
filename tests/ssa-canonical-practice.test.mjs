import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake } from '../intake-checker/parser.js';
import { createIntakeSession, correctIntakeField } from '../intake-checker/session.js';
import { createClientData } from '../intake-checker/client-data.js';
import { canonicalPracticeProfile } from '../ssa-intake-assistant/src/model/canonical-practice-profile.js';
import { mappings, planPractice } from '../ssa-intake-assistant/extension-dev/mapping.js';
import { projectReady } from '../ssa-intake-assistant/extension-dev/bridge-contract.js';
import { completeSyntheticIntake } from '../ssa-intake-assistant/tests/complete-intake.mjs';

const canonical = () => createClientData(createIntakeSession(parseIntake(completeSyntheticIntake())));

test('canonical Checker data projects only exact ready practice questions', () => {
  const data = canonical(), profile = canonicalPracticeProfile(data);
  const ids = mappings.filter(mapping => mapping.definitionId).map(mapping => mapping.definitionId);
  assert.deepEqual(profile.fields.map(field => field.id), ids);
  assert.equal(profile.schema, 'packard.intake-client-profile');
  assert.equal(profile.schemaVersion, '3.0.0');
  assert.equal(planPractice(profile).filter(item => item.status === 'ready').length, 8);
  assert.deepEqual(projectReady(profile), profile);
  assert(!JSON.stringify(profile).includes('Synthetic condition'));
  for (const field of profile.fields) assert.deepEqual(Object.keys(field).sort(),
    ['id', 'definitionId', 'recordId', 'dataType', 'value', 'precision', 'readiness', 'blockingReasons'].sort());
});

test('unresolved Checker notices stop transfer; dismissed errors do not turn invalid values ready', () => {
  const data = canonical();
  data.validationIssues.push({ id: 'synthetic-issue', dismissed: false });
  assert.equal(canonicalPracticeProfile(data).fields.length, 0);
  data.validationIssues[0].dismissed = true;
  const field = data.fields.find(item => item.definitionId === 'personal.first-name');
  field.validation.hasErrors = true;
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === field.definitionId));
  field.validation.hasErrors = false;
  field.validation.unresolvedIssueIds.push('synthetic-issue');
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === field.definitionId));
});

test('missing, ambiguous, conflicts, invalid values and malformed validation never transfer', () => {
  for (const status of ['missing', 'ambiguous', 'conflict', 'invalid']) {
    const data = canonical(), field = data.fields.find(item => item.definitionId === 'personal.first-name');
    field.valueStatus = status;
    assert(!canonicalPracticeProfile(data).fields.some(item => item.id === field.definitionId), status);
  }
  const data = canonical(), field = data.fields.find(item => item.definitionId === 'personal.first-name');
  delete field.validation;
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === field.definitionId));
  assert.equal(canonicalPracticeProfile({ ...data, schemaVersion: 'unknown' }).fields.length, 0);
});

test('date precision, duplicate singleton and employee correction are respected in memory', () => {
  const data = canonical();
  const lastWorked = data.fields.find(item => item.definitionId === 'employment.when-did-you-last-work');
  lastWorked.precision = 'month';
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === lastWorked.definitionId));
  const onset = data.fields.find(item => item.definitionId === 'disability.onset-date-of-disability');
  onset.precision = 'month';
  assert(canonicalPracticeProfile(data).fields.some(item => item.id === onset.definitionId));
  data.fields.push({ ...data.fields.find(item => item.definitionId === 'personal.first-name') });
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === 'personal.first-name'));

  const session = createIntakeSession(parseIntake(completeSyntheticIntake()));
  assert(correctIntakeField(session, { nodePath: '/0', section: 'PERSONAL INFORMATION', label: 'First Name' }, 'Example'));
  const edited = createClientData(session);
  const corrected = canonicalPracticeProfile(edited).fields.find(item => item.id === 'personal.first-name');
  assert.equal(corrected.value, 'Example');
  assert.equal(edited.fields.find(item => item.definitionId === 'personal.first-name').origin, 'employee_entered');
});
