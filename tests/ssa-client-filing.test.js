import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake } from '../intake-checker/parser.js';
import { createIntakeSession, correctIntakeField, canContinueToSsa } from '../intake-checker/session.js';
import { createClientData } from '../intake-checker/client-data.js';
import { clientFilingText } from '../ssa-intake-assistant/src/model/client-filing-text.js';
import { completeSyntheticIntake } from '../ssa-intake-assistant/tests/complete-intake.mjs';

test('filing text includes every canonical field and occurrence without filtering by validation', () => {
  const data = createClientData(createIntakeSession(parseIntake(completeSyntheticIntake())));
  const text = clientFilingText(data);
  const lines = text.split('\n').filter(line => line.includes(': '));
  assert.equal(lines.length, data.fields.reduce((count, field) => count + Math.max(1, field.occurrences.length), 0));
  assert.match(text, /FirstName: Synthetic/);
  assert.match(text, /CurrentlyWorking: No/);
});

test('repeating records, duplicates, invalid values, blanks and unparsed text stay visible', () => {
  const state = createIntakeSession(parseIntake('PERSONAL INFORMATION\nFirst Name: Synthetic\nFirst Name: Different\nPhone Number: 123\nMiddle Name: Not provided\nMEDICAL PROVIDERS\nClinic 1\nClinic Name: First Synthetic\nClinic 2\nClinic Name: Second Synthetic\nUnmapped question: Synthetic value'));
  const before = clientFilingText(createClientData(state));
  assert.match(before, /FirstName1: Synthetic\nFirstName2: Different/);
  assert.match(before, /PhoneNumber: 123/);
  assert.match(before, /MiddleName: Not provided/);
  assert.match(before, /\[MEDICAL PROVIDERS \/ Clinic 1\]/);
  assert.match(before, /\[MEDICAL PROVIDERS \/ Clinic 2\]/);
  assert.match(before, /Synthetic value/);
  state.report.issues.forEach(state.validationState.review);
  state.review.items.forEach(state.reviewState.review);
  assert.equal(clientFilingText(createClientData(state)), before, 'dismissal does not remove or manufacture answers');
});

test('employee corrections use current Checker values without mutating the canonical snapshot', () => {
  const state = createIntakeSession(parseIntake('PERSONAL INFORMATION\nPhone Number: 123'));
  assert(correctIntakeField(state, { nodePath: '/0', section: 'PERSONAL INFORMATION', label: 'Phone Number' }, '2025550142'));
  const data = createClientData(state), before = JSON.stringify(data);
  assert.match(clientFilingText(data), /PhoneNumber: 202-555-0142/);
  assert.equal(JSON.stringify(data), before);
  assert.equal(data.fields.find(field => field.definitionId === 'personal.phone-number').origin, 'employee_entered');
});

test('filing handoff waits for all validation issues and all review flags', () => {
  const session = createIntakeSession(parseIntake('PERSONAL INFORMATION\nFirst Name: Synthetic\nEMPLOYMENT INFORMATION\nCurrently working: Yes'));
  assert(!canContinueToSsa(session));
  session.report.issues.forEach(session.validationState.review);
  assert(session.reviewState.remaining().length > 0);
  assert(!canContinueToSsa(session));
  session.review.items.forEach(session.reviewState.review);
  assert(canContinueToSsa(session));
  assert(!canContinueToSsa(createIntakeSession(parseIntake('Unrecognized text'), { validate: false })));
  assert(!canContinueToSsa(null));
});
