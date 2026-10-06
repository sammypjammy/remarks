import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatIntakeValue, inspectFormats } from '../intake-checker/formats.js';
import { parseIntake, sourceRange } from '../intake-checker/parser.js';
import { createIntakeSession, correctIntakeField } from '../intake-checker/session.js';
import { fromIntakeChecker } from '../ssa-intake-assistant/src/model/from-intake-checker.js';

// Synthetic names, reserved example domains, fictional phone numbers and invalid SSNs only.
const format = (label, value, section = 'PERSONAL INFORMATION') => formatIntakeValue(section, label, value);
test('names/places permit Unicode letters and spaces, title case, and remove other characters', () => {
  for (const [label, value, expected, section] of [
    ['First Name', "  sYNTHETIC-'12. EXAMPLE  ", 'Synthetic Example', 'PERSONAL INFORMATION'],
    ['City of Birth', 'SYNTHÉTIC-CITY2', 'Synthéticcity', 'BIRTH INFORMATION'],
    ['Teacher Name', 'sYNTHETIC EXAMPLE', 'Synthetic Example', 'SCHOOL INFORMATION'],
    ['Doctor Last Name', 'eXAMPLE.', 'Example', 'MEDICAL PROVIDERS'],
    ['Employer', 'EXAMPLE COMPANY', 'Example Company', 'WORK HISTORY'],
  ]) assert.deepEqual(format(label, value, section), { kind: label.includes('Name') && !label.includes('City') ? 'name' : 'place', value: expected, error: null });
  assert(format('First Name', '123---').error);
});
test('addresses preserve numbers; email and free text are not title-cased or stripped', () => {
  assert.equal(format('Mailing Address - Street Address', '123 EXAMPLE ST. #4', 'ADDRESS INFORMATION').value, '123 Example St 4');
  for (const value of ['Synthetic.Example+audit@Example.test', "synthetic'example@example.test"]) {
    assert.equal(format('Email', value).value, value);
    assert.equal(format('Email', value).error, null);
  }
  for (const label of ['Notes', 'Remarks/Comments', 'Unknown question']) {
    const value = 'MiXeD: $2.00 / . , \' " @\nsecond line';
    assert.deepEqual(format(label, value, 'MEDICAL PROVIDERS'), { kind: null, value, error: null });
  }
  assert.equal(format('First Name', 'Mixed.123', 'UNMAPPED').value, 'Mixed.123');
});
test('email syntax rejects missing domain/at, whitespace, invalid dot and domain boundaries', () => {
  for (const value of ['plain', 'a@', '@example.test', 'a@@example.test', 'a b@example.test', 'a@example', '.a@example.test', 'a..b@example.test', 'a@-example.test', 'a@example..test']) assert(format('Email', value).error, 'malformed synthetic email');
});
test('phone, SSN and ZIP count digits without padding/truncating and preserve leading zeroes', () => {
  for (const [label, value, expected] of [
    ['Phone Number', '(202) 555.0142', '202-555-0142'],
    ['Social Security Number', '000123456', '000-12-3456'],
  ]) assert.equal(format(label, value).value, expected);
  assert.equal(format('School Zip Code', '00000', 'SCHOOL INFORMATION').value, '00000');
  for (const [label, value, section] of [
    ['Phone Number', '202555014', 'PERSONAL INFORMATION'],
    ['Phone Number', '+1 (202) 555-0142', 'PERSONAL INFORMATION'],
    ['Phone Number', 'abc2025550142', 'PERSONAL INFORMATION'],
    ['Social Security Number', '00012345', 'PERSONAL INFORMATION'],
    ['Social Security Number', '0001234567', 'PERSONAL INFORMATION'],
    ['Zipcode', '0000', 'MEDICAL PROVIDERS'],
    ['Zipcode', '00000-0000', 'MEDICAL PROVIDERS'],
  ]) {
    const result = format(label, value, section);
    assert(result.error); assert.equal(result.value, value, 'invalid input is not silently repaired');
  }
});
test('dates check the calendar, allow month/year and retain precision without inventing a day', () => {
  for (const label of ['Date of Birth', 'First Visit Date', 'Last Visit Date', 'Next Visit Date', 'Start Date', 'End Date', 'Marriage Date', 'School End Date', 'When did you last work', 'Onset date of disability']) {
    const section = label === 'Date of Birth' ? 'BIRTH INFORMATION' : label.includes('Visit') ? 'MEDICAL PROVIDERS' : ['Start Date','End Date'].includes(label) ? 'WORK HISTORY' : label === 'Marriage Date' ? 'MARRIAGE INFORMATION' : label === 'School End Date' ? 'SCHOOL INFORMATION' : label === 'When did you last work' ? 'EMPLOYMENT INFORMATION' : 'DISABILITY INFORMATION';
    assert(format(label, '02/30/2000', section).error);
    assert.equal(format(label, '2000-02', section).value, '02/2000');
    assert.equal(format(label, '2000-02', section).precision, 'month');
    assert.equal(format(label, '2000-02-29', section).value, '02/29/2000');
  }
});
test('amounts allow a decimal and leading dollar sign; malformed amounts block', () => {
  for (const value of ['0', '$10.25', '.50', '$.50']) assert.equal(format('Rate of Pay', value, 'WORK HISTORY').error, null);
  for (const value of ['$1.2.3', '$', '10 dollars', '1,000', '-10']) assert(format('Rate of Pay', value, 'WORK HISTORY').error);
});
test('absent optional fields are not created, blank stays blank, stripped-empty names block', () => {
  assert.equal(format('First Name', null).value, null);
  const session = createIntakeSession(parseIntake('PERSONAL INFORMATION\nFirst Name: ---'));
  const profile = fromIntakeChecker(session);
  assert.equal(profile.fields.find(f => f.id === 'personal.first-name').readiness, 'blocked');
  assert(!profile.fields.some(f => f.id === 'personal.alternate-phone'));
});
test('Checker owns format errors; dismissal cannot make malformed answers ready and corrections revalidate', () => {
  const text = 'PERSONAL INFORMATION\r\nFirst Name: sYNTHETIC.\r\nPhone Number: 202555014\r\nEmail: Synthetic@Example.test';
  const parsed = parseIntake(text), snapshot = JSON.stringify(parsed);
  const state = createIntakeSession(parsed);
  state.report.issues.forEach(state.validationState.review);
  let profile = fromIntakeChecker(state);
  const name = profile.fields.find(f => f.id === 'personal.first-name');
  assert.equal(name.value, 'Synthetic'); assert.equal(name.sources[0].rawValue, 'sYNTHETIC.');
  assert.equal(name.origin, 'parsed'); assert.equal(name.employeeReview.status, 'not_reviewed');
  const phone = profile.fields.find(f => f.id === 'personal.phone-number');
  assert.equal(phone.readiness, 'blocked');
  assert(phone.validation.issues.some(i => i.severity === 'error' && i.message.includes('10 digits')));
  assert.equal(JSON.stringify(parsed), snapshot);
  const field = parsed.sections[0].fields[1], range = sourceRange(field);
  assert(correctIntakeField(state, phone.correctionTarget, '(202) 555-0142'));
  profile = fromIntakeChecker(state);
  const corrected = profile.fields.find(f => f.id === phone.id);
  assert.equal(corrected.value, '202-555-0142'); assert.equal(corrected.readiness, 'ready');
  assert.equal(corrected.origin, 'employee_entered');
  assert.equal(corrected.sources[0].rawValue, '202555014'); assert.deepEqual(corrected.sources[0].range, range);
});
test('format inspection is scoped, recursive, and covers standalone last-visit dates', () => {
  const report = inspectFormats(parseIntake('MEDICAL PROVIDERS\nClinic 1\nLast Visit Date: invalid\n##### Nested\nPhone Number: 123\nEDUCATION INFORMATION\nSchool Phone Number: 123'));
  assert.deepEqual(report.issues.map(i => [i.section, i.field, i.location]), [
    ['MEDICAL PROVIDERS','Last Visit Date','/0/0'], ['MEDICAL PROVIDERS','Phone Number','/0/0/0'], ['SCHOOL INFORMATION','School Phone Number','/1'],
  ]);
});
test('a dismissed precision warning unblocks its field without changing month precision', () => {
  const state = createIntakeSession(parseIntake('MEDICAL PROVIDERS\nClinic 1\nFirst Visit Date: 01/2000\nLast Visit Date: 01/2000'));
  const find = () => fromIntakeChecker(state).fields.find(f => f.definitionId === 'providers.last-visit-date');
  assert.equal(find().readiness, 'blocked');
  state.report.issues.filter(i => i.severity === 'warning').forEach(state.validationState.review);
  assert.equal(find().readiness, 'ready'); assert.equal(find().value, '2000-01');
});
test('formatting has no data storage, logging or transport', () => {
  for (const file of ['formats.js','values.js']) assert.doesNotMatch(readFileSync(new URL('../intake-checker/'+file, import.meta.url),'utf8'), /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon|console\.|postMessage\(/);
});
