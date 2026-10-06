import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIntake, sourceRange } from '../../../intake-checker/parser.js';
import { createIntakeSession, correctIntakeField } from '../../../intake-checker/session.js';
import { intakeRules } from '../../../intake-checker/rules.js';
import { reviewFields } from '../../../intake-checker/review-fields.js';
import { fromIntakeChecker } from './from-intake-checker.js';
import { fieldDefinitions, readyFields, PROFILE_SCHEMA_VERSION, FIELD_TYPES, profileSummary } from './intake-contract.js';
import { completeSyntheticIntake } from '../../tests/complete-intake.mjs';

const session = text => createIntakeSession(parseIntake(text));
const field = (profile, id) => profile.fields.find(item => item.id === id);
const profile = text => fromIntakeChecker(session(text));

test('catalog covers every existing fixed parser label, all 119 meanings and the medical problem family', () => {
  const knownLabels = new Set(fieldDefinitions.map(item => item.label));
  const rules = [...Object.values(intakeRules.sections), ...Object.values(intakeRules.records)];
  for (const label of [...rules.flatMap(rule => [...(rule.required || []), ...(rule.optional || []), ...(rule.currentYearAddress || [])]), ...reviewFields,
    'Last Visit Date', 'Have you ever worked', 'Used other names in medical records', 'Other first name', 'Other last name', 'Remarks/Comments']) assert(knownLabels.has(label));
  assert.equal(fieldDefinitions.length, 119);
  assert.equal(new Set(fieldDefinitions.map(item => item.id)).size, 119);
  const result = profile(completeSyntheticIntake());
  assert.equal(result.fields.length, 120);
  assert.equal(result.fields.filter(item => item.sources.length).length, 120);
  assert.equal(readyFields(result).length, 120);
  for (const definition of fieldDefinitions) {
    assert(result.fields.some(item => item.definitionId === definition.id));
    assert(FIELD_TYPES.includes(definition.dataType));
  }
});

test('contract version and IDs are stable across values, rechecking and unrelated section order', () => {
  const a = profile('PERSONAL INFORMATION\nFirst Name: Synthetic\nWORK HISTORY\nMost Recent Job\nStart Date: 2000-01-01');
  const b = profile('WORK HISTORY\nMost Recent Job\nStart Date: 2001-02-03\nPERSONAL INFORMATION\nFirst Name: Edited');
  assert.equal(PROFILE_SCHEMA_VERSION, '3.0.0');
  assert.equal(a.schema, 'packard.intake-client-profile');
  assert.equal(a.schemaVersion, '3.0.0');
  assert(field(a, 'personal.first-name'));
  assert(field(b, 'personal.first-name'));
  assert(field(a, 'jobs.start-date@jobs-1'));
  assert(field(b, 'jobs.start-date@jobs-1'));
  assert.deepEqual(readyFields({ ...a, schemaVersion: '99.0.0' }), []);
});

test('valid direct answers become ready without manufactured employee confirmation', () => {
  const result = profile('PERSONAL INFORMATION\nFirst Name: Synthetic\nEMPLOYMENT INFORMATION\nCurrently working: No');
  assert.equal(field(result, 'personal.first-name').readiness, 'ready');
  assert.equal(field(result, 'personal.first-name').employeeReview.status, 'not_reviewed');
  assert.equal(field(result, 'employment.currently-working').value, false);
  assert.equal(field(result, 'employment.currently-working').readiness, 'ready');
  assert(!JSON.stringify(result).includes('employeeConfirmed'));
});

for (const value of ['', 'Not provided', '*Not provided*', 'N/A', 'unknown', '-', 'Select one', 'TBD', 'Not applicable', 'Not available', 'NaN']) test(`placeholder becomes missing: ${value || 'blank'}`, () => {
  const result = field(profile(`PERSONAL INFORMATION\nFirst Name: ${value}`), 'personal.first-name');
  assert.equal(result.value, null);
  assert.equal(result.readiness, 'blocked');
  assert(result.blockingReasons.some(reason => reason.code === 'missing'));
});

test('impossible dates are missing and month precision remains explicit', () => {
  for (const value of ['02/30/2000', '0000-01-01', '2000-13-01']) {
    const result = field(profile(`BIRTH INFORMATION\nDate of Birth: ${value}`), 'birth.date-of-birth');
    assert.equal(result.value, null);
    assert(result.blockingReasons.some(reason => reason.code === 'missing'));
  }
  const result = field(profile('BIRTH INFORMATION\nDate of Birth: 01/2000'), 'birth.date-of-birth');
  assert.equal(result.value, '2000-01');
  assert.equal(result.precision, 'month');
});

test('conflicts preserve all candidates and source offsets without choosing an answer', () => {
  const text = 'PERSONAL INFORMATION\r\nFirst Name: Synthetic\r\nFirst Name: Different';
  const result = field(profile(text), 'personal.first-name');
  assert.equal(result.value, null);
  assert.equal(result.readiness, 'blocked');
  assert(result.blockingReasons.some(reason => reason.code === 'conflict'));
  assert.equal(result.correctionTarget, null);
  assert.deepEqual(result.sources.map(source => source.rawValue), ['Synthetic', 'Different']);
  for (const source of result.sources) assert.equal(text.slice(source.range.start, source.range.end), `First Name: ${source.rawValue}`);
});

test('unknown labels, unparsed text, duplicate sections and uncertain booleans are blocked', () => {
  for (const text of ['## CUSTOM\n**Unmapped question:** Synthetic', 'PERSONAL INFORMATION\nFirst Name: Synthetic\nPERSONAL INFORMATION\nFirst Name: Synthetic', 'EMPLOYMENT INFORMATION\nCurrently working: Sometimes']) {
    const received = profile(text).fields.filter(item => item.sources.length);
    assert(received.length);
    assert(received.every(item => item.readiness === 'blocked' && item.blockingReasons.some(reason => reason.code === 'ambiguous')));
  }
});

test('unresolved validation blocks only its own field; dismissing an error does not repair it', () => {
  const state = session('PERSONAL INFORMATION\nFirst Name: 123\nLast Name: Example');
  state.report.issues.forEach(state.validationState.review);
  const result = fromIntakeChecker(state);
  assert.equal(field(result, 'personal.first-name').readiness, 'blocked');
  assert.equal(field(result, 'personal.first-name').employeeReview.status, 'acknowledged');
  assert.equal(field(result, 'personal.last-name').readiness, 'ready');
  assert.equal(field(result, 'personal.email').value, null);
  assert.equal(field(result, 'personal.email').readiness, 'blocked');
});

test('dismissed general flags preserve established answers and do not block or invent them', () => {
  const state = session('EMPLOYMENT INFORMATION\nCurrently working: Yes');
  state.review.items.forEach(state.reviewState.review);
  const result = fromIntakeChecker(state);
  assert.equal(field(result, 'employment.currently-working').value, true);
  assert.equal(field(result, 'employment.currently-working').readiness, 'ready');
  assert.equal(field(result, 'employment.currently-working').employeeReview.status, 'acknowledged');
  assert(result.reviewDecisions.every(item => item.acknowledged));
  assert.equal(field(result, 'employment.when-did-you-last-work').value, null);
});

test('a scoped warning can be acknowledged without changing its source date precision', () => {
  const state = session('MEDICAL PROVIDERS\nClinic 1\nFirst Visit Date: 01/2000\nLast Visit Date: 01/2000');
  const id = 'providers.last-visit-date@providers-1';
  assert.equal(field(fromIntakeChecker(state), id).readiness, 'blocked');
  state.report.issues.filter(issue => issue.field === 'Last Visit Date').forEach(state.validationState.review);
  const answer = field(fromIntakeChecker(state), id);
  assert.equal(answer.readiness, 'ready');
  assert.equal(answer.precision, 'month');
  assert.equal(answer.employeeReview.status, 'acknowledged');
});

test('corrections update the existing Checker session, revalidate and preserve original provenance', () => {
  const state = session('PERSONAL INFORMATION\nFirst Name: 123\nEMPLOYMENT INFORMATION\nCurrently working: Yes');
  state.review.items.forEach(state.reviewState.review);
  const original = state.parsed.sections[0].fields[0];
  const range = sourceRange(original);
  const before = field(fromIntakeChecker(state), 'personal.first-name');
  assert(correctIntakeField(state, before.correctionTarget, 'Edited'));
  const after = field(fromIntakeChecker(state), 'personal.first-name');
  assert.equal(original.value, 'Edited');
  assert.equal(after.readiness, 'ready');
  assert.equal(after.origin, 'employee_entered');
  assert.equal(after.employeeReview.status, 'employee_entered');
  assert.equal(after.employeeReview.edits[0].value, 'Edited');
  assert.equal(after.sources[0].rawValue, '123');
  assert.deepEqual(after.sources[0].range, range);
  assert.equal(state.reviewState.remaining().length, 0, 'unrelated dismissal survives');
  assert(correctIntakeField(state, after.correctionTarget, '456'));
  assert.equal(field(fromIntakeChecker(state), 'personal.first-name').readiness, 'blocked');
});

test('correcting missing fields preserves original null and can add an absent required section', () => {
  const state = session('PERSONAL INFORMATION\nFirst Name: Not provided');
  const before = field(fromIntakeChecker(state), 'personal.first-name');
  assert(correctIntakeField(state, before.correctionTarget, 'Synthetic'));
  assert.equal(field(fromIntakeChecker(state), before.id).sources[0].rawValue, null);
  const missing = field(fromIntakeChecker(state), 'birth.date-of-birth');
  assert(correctIntakeField(state, missing.correctionTarget, '2000-01-02'));
  assert.equal(field(fromIntakeChecker(state), missing.id).value, '2000-01-02');
});

test('similar dates remain separate; no stopped-work answer is inferred', () => {
  const result = profile('DISABILITY INFORMATION\nOnset date of disability: 2000-01-01\nEMPLOYMENT INFORMATION\nWhen did you last work: 2001-01-01\n**Date work stopped:** 2002-01-01\nWORK HISTORY\nMost Recent Job\nEnd Date: 2003-01-01');
  assert.equal(field(result, 'disability.onset-date-of-disability').value, '2000-01-01');
  assert.equal(field(result, 'employment.when-did-you-last-work').value, '2001-01-01');
  assert.equal(field(result, 'jobs.end-date@jobs-1').value, '2003-01-01');
  const stopped = result.fields.find(item => item.label === 'Date work stopped');
  assert.equal(stopped.readiness, 'blocked');
  assert.equal(stopped.sources[0].rawValue, '2002-01-01');
});

test('record identity, missing requirements, arbitrary recursive fields and duplicate current spouses remain explicit', () => {
  const result = profile('MEDICAL PROVIDERS\nClinic 1\nPhone Number: (202) 555-0142\nClinic 2\nPhone Number: Not provided\n##### Extra\n**Unknown:** Synthetic\nMARRIAGE INFORMATION\nMarital Status: Married\nCurrent Spouse\nFirst Name: Synthetic\nCurrent Spouse\nFirst Name: Example');
  assert.equal(field(result, 'providers.phone-number@providers-1').readiness, 'ready');
  assert.equal(field(result, 'providers.phone-number@providers-2').readiness, 'blocked');
  assert(result.fields.some(item => item.label === 'Unknown' && item.readiness === 'blocked'));
  assert(result.fields.filter(item => item.category === 'spouse').every(item => item.readiness === 'blocked'));
  const summary = profileSummary(result);
  assert.equal(summary.total, summary.ready + summary.blocked);
  assert(summary.missing > 0);
});

test('all parsed source fields survive transformation without mutations', () => {
  const text = completeSyntheticIntake() + '\n## UNMAPPED\n**Unknown:** Synthetic\n**Unknown:** Other';
  const state = session(text), snapshot = JSON.stringify(state.parsed);
  const result = fromIntakeChecker(state);
  const flatten = nodes => nodes.flatMap(node => [...node.fields, ...flatten(node.subsections)]);
  assert.equal(result.fields.reduce((sum, item) => sum + item.sources.length, 0), flatten(state.parsed.sections).length);
  assert.equal(JSON.stringify(state.parsed), snapshot);
});

test('profile and correction code use no persistence, navigation or client-data transport', () => {
  for (const file of ['./from-intake-checker.js', './intake-contract.js', '../intake-handoff.jsx', '../ReadinessDashboard.jsx', '../../../intake-checker/session.js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon|console\.|history\.|postMessage\(/);
  }
});

test('documented schema catalog matches every stable ID, scope and type', () => {
  const documentation = readFileSync(new URL('../../PROFILE-CONTRACT.md', import.meta.url), 'utf8');
  const rows = documentation.split('\n').filter(line => /^\| [a-z-]+\.[a-z0-9-]+ \|/.test(line));
  assert.equal(rows.length, 119);
  assert.deepEqual(rows, fieldDefinitions.map(item => `| ${item.id} | ${item.section}${item.record ? ' / record' : ''} | ${item.label} | ${item.dataType} |`));
});

test('school fallback retains actual parent provenance and warnings remain record-scoped', () => {
  const result = profile('EDUCATION INFORMATION\nSchool City: Synthetic\nMEDICAL PROVIDERS\nClinic 1\nFirst Visit Date: 2001-01-01\nLast Visit Date: 2000-01-01\nClinic 2\nFirst Visit Date: 2000-01-01\nLast Visit Date: 2001-01-01');
  assert.equal(field(result, 'school.school-city').sources[0].section, 'EDUCATION INFORMATION');
  assert.equal(field(result, 'providers.last-visit-date@providers-1').readiness, 'blocked');
  assert.equal(field(result, 'providers.last-visit-date@providers-2').readiness, 'ready');
});
