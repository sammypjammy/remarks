import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIntake } from '../../../intake-checker/parser.js';
import { validateIntake } from '../../../intake-checker/validation.js';
import { reviewIntake } from '../../../intake-checker/review.js';
import { createAcknowledgements } from '../../../intake-checker/acknowledgements.js';
import { fromIntakeChecker, intakeMappings } from './from-intake-checker.js';
import { getField, editAnswer, confirmAnswer } from './review.js';
import { phaseOneFields } from '../pdf/parseIntake.js';

export function session(text) {
  const parsed = parseIntake(text);
  const report = validateIntake(parsed);
  const review = reviewIntake(parsed);
  return { parsed, report, review, validationState: createAcknowledgements(report.issues), reviewState: createAcknowledgements(review.items) };
}

test('maps every Phase 1 field from existing parser results with source offsets', () => {
  assert.deepEqual(intakeMappings.map(([path]) => path).sort(), [...phaseOneFields].sort());
  const text = intakeMappings.map(([, section, labels]) => `## ${section}\n**${labels[0]}:** Synthetic`).join('\n');
  const profile = fromIntakeChecker(session(text));
  assert.equal(profile.source.transferredCount, 14);
  for (const [path,, labels] of intakeMappings) {
    const field = getField(profile, path);
    assert.equal(field.value, 'Synthetic');
    assert.equal(field.employeeConfirmed, false);
    assert(field.sourceLocations.length);
    const range = field.sourceLocations[0].range;
    assert.equal(text.slice(range.start, range.end), `**${labels[0]}:** Synthetic`);
  }
});

test('uses client sections only and preserves missing values', () => {
  const profile = fromIntakeChecker(session('PERSONAL INFORMATION\nFirst Name: Synthetic\nEmail: Not provided\nMARRIAGE INFORMATION\n#### Current Spouse\n**Last Name:** Other\nMEDICAL PROVIDERS\n#### Clinic 1\nPhone Number: (202) 555-0142'));
  assert.equal(profile.personal.firstName.status, 'needs_review');
  assert.equal(profile.personal.lastName.status, 'missing');
  assert.equal(profile.contact.phone.status, 'missing');
  assert.equal(profile.contact.email.status, 'missing');
  assert.equal(profile.contact.email.sourceLocations.length, 1);
});

test('dismissed validation and review issues remain acknowledgements, never confirmations', () => {
  const state = session('PERSONAL INFORMATION\nFirst Name: SYNTHETIC\nEmail: Not provided\nEMPLOYMENT INFORMATION\nCurrently working: Yes');
  state.report.issues.forEach(state.validationState.review);
  state.review.items.forEach(state.reviewState.review);
  const profile = fromIntakeChecker(state);
  assert(profile.source.intakeIssues.every(issue => issue.reviewed));
  assert(profile.source.reviewItems.every(item => item.reviewed));
  assert.equal(profile.personal.firstName.status, 'needs_review');
  assert.equal(profile.personal.firstName.employeeConfirmed, false);
  assert.equal(profile.contact.email.status, 'missing');
  assert(profile.contact.email.intakeIssues.some(issue => issue.reviewed));
});

test('preserves conflicts, alternatives and every source; identical repeated sections stay ambiguous', () => {
  for (const suffix of ['First Name: Different', 'PERSONAL INFORMATION\nFirst Name: Synthetic']) {
    const profile = fromIntakeChecker(session(`PERSONAL INFORMATION\nFirst Name: Synthetic\n${suffix}`));
    assert.equal(profile.personal.firstName.status, 'conflict');
    assert.equal(profile.personal.firstName.employeeConfirmed, false);
    assert.equal(profile.personal.firstName.candidates.length, 2);
    assert.equal(profile.personal.firstName.sourceLocations.length, 2);
  }
});

test('current employee source edits transfer and complete dates use existing calendar parsing', () => {
  const profile = fromIntakeChecker(session('PERSONAL INFORMATION\nFirst Name: Edited\nBIRTH INFORMATION\nDate of Birth: 2000-01-02'));
  assert.equal(profile.personal.firstName.value, 'Edited');
  assert.equal(profile.personal.dateOfBirth.value, '01/02/2000');
  assert.equal(profile.personal.dateOfBirth.status, 'needs_review');
  const confirmed = confirmAnswer(profile, 'personal.firstName', true);
  const edited = editAnswer(confirmed, 'personal.firstName', 'Synthetic');
  assert.equal(edited.personal.firstName.employeeConfirmed, false);
  assert.deepEqual(edited.personal.firstName.sourceLocations, profile.personal.firstName.sourceLocations);
});

test('partial or invalid dates are not guessed or confirmed; unresolved parser state survives', () => {
  for (const value of ['01/2000', '02/30/2000', 'Unknown']) {
    const profile = fromIntakeChecker(session(`Unrecognized preface\nBIRTH INFORMATION\nDate of Birth: ${value}`));
    assert.equal(profile.personal.dateOfBirth.value, value);
    assert.equal(profile.personal.dateOfBirth.status, 'needs_review');
    assert.equal(profile.source.parsingNeedsReview, true);
  }
});

test('handoff and adapter contain no client-data transport or persistence APIs', () => {
  for (const file of ['../intake-handoff.jsx', './from-intake-checker.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon|console\.|history\.|postMessage\(/);
  }
});
