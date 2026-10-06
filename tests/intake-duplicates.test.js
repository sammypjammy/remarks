import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake } from '../intake-checker/parser.js';
import { createIntakeSession } from '../intake-checker/session.js';
import { fromIntakeChecker } from '../ssa-intake-assistant/src/model/from-intake-checker.js';
const session = text => createIntakeSession(parseIntake(text));
const conflicts = state => state.report.issues.filter(issue => issue.code === 'conflict');
const get = (state, id) => fromIntakeChecker(state).fields.find(field => field.id === id);

test('identical and format-equivalent answers combine while every original source survives', () => {
  const text = 'PERSONAL INFORMATION\nFirst Name: SYNTHETIC\nFirst Name: Synthetic\nPhone Number: (202) 555-0142\nPhone Number: 202-555-0142\nBIRTH INFORMATION\nDate of Birth: 2000-01-02\nDate of Birth: 1/2/2000';
  const state = session(text);
  const before = JSON.stringify(state.parsed);
  assert.equal(conflicts(state).length, 0);
  for (const id of ['personal.first-name', 'personal.phone-number', 'birth.date-of-birth']) {
    const field = get(state, id);
    assert.equal(field.readiness, 'ready');
    assert.equal(field.sources.length, 2);
    for (const source of field.sources) assert(text.slice(source.range.start, source.range.end).includes(source.rawValue));
  }
  assert.equal(state.review.identifier, 'Synthetic');
  assert.equal(JSON.stringify(state.parsed), before);
});

test('different answers are non-dismissable errors with links to both sources', () => {
  const text = 'PERSONAL INFORMATION\nFirst Name: Synthetic\nFirst Name: Different';
  const state = session(text);
  const [issue] = conflicts(state);
  assert.equal(issue.severity, 'error');
  assert.equal(issue.sources.length, 2);
  issue.sources.forEach(range => assert(text.slice(range.start, range.end).startsWith('First Name:')));
  state.report.issues.forEach(state.validationState.review);
  const field = get(state, 'personal.first-name');
  assert.equal(field.value, null);
  assert.equal(field.readiness, 'blocked');
  assert(field.blockingReasons.some(reason => reason.code === 'conflict'));
});

test('blank versus supplied conflicts in either order; missing-only duplicates remain missing', () => {
  for (const values of [['', 'Synthetic'], ['Synthetic', 'Not provided']]) {
    const state = session('PERSONAL INFORMATION\n' + values.map(value => 'First Name: ' + value).join('\n'));
    assert.equal(conflicts(state).length, 1);
    assert.equal(get(state, 'personal.first-name').value, null);
  }
  const state = session('PERSONAL INFORMATION\nFirst Name: \nFirst Name: Not provided');
  assert.equal(conflicts(state).length, 0);
  assert(get(state, 'personal.first-name').blockingReasons.some(reason => reason.code === 'missing'));
});

test('same-name jobs, providers and children remain independent records', () => {
  const state = session('WORK HISTORY\nMost Recent Job\nEmployer: Synthetic\nPrevious Job\nEmployer: Synthetic\nMEDICAL PROVIDERS\nClinic 1\nClinic Name: Synthetic\nClinic 2\nClinic Name: Synthetic\nCHILDREN INFORMATION\n#### Child A\nFirst Name: Synthetic\n#### Child B\nFirst Name: Synthetic');
  const profile = fromIntakeChecker(state);
  for (const id of ['jobs.employer', 'providers.clinic-name', 'children.first-name']) {
    const fields = profile.fields.filter(field => field.definitionId === id);
    assert.equal(fields.length, 2);
    assert.notEqual(fields[0].recordId, fields[1].recordId);
    assert(fields.every(field => field.sources.length === 1));
  }
  assert.equal(conflicts(state).length, 0);
});

test('optional and unsupported duplicate labels also report conflicts', () => {
  const state = session('PERSONAL INFORMATION\nNickname: Synthetic\nNickname: Different\n**Synthetic unknown:** one\n**Synthetic unknown:** two');
  assert.deepEqual(conflicts(state).map(issue => issue.field), ['Nickname', 'Synthetic unknown']);
});

test('date conflicts skip dependent checks; equivalent full dates retain them', () => {
  const prefix = 'MEDICAL PROVIDERS\nClinic 1\nFirst Visit Date: 2000-01-02\n';
  const bad = session(prefix + 'First Visit Date: 2001-01-02\nLast Visit Date: 2000-01-01');
  assert.equal(conflicts(bad).length, 1);
  assert(!bad.report.issues.some(issue => issue.message.includes('on or after')));
  const same = session(prefix + 'First Visit Date: 1/2/2000\nLast Visit Date: 2000-01-01');
  assert.equal(conflicts(same).length, 0);
  assert(same.report.issues.some(issue => issue.message.includes('on or after')));
});

test('identical repeated review answers produce one flag; contradictory answers produce none', () => {
  const same = session('EMPLOYMENT INFORMATION\nCurrently working: Yes\nCurrently working: Yes');
  assert.equal(same.review.items.filter(item => item.message === 'Currently Working').length, 1);
  const bad = session('EMPLOYMENT INFORMATION\nCurrently working: Yes\nCurrently working: No');
  assert.equal(bad.review.items.length, 0);
  assert.equal(conflicts(bad).length, 1);
});

test('repeated singleton sections retain ambiguity and conflicting values are red', () => {
  const state = session('PERSONAL INFORMATION\nFirst Name: Synthetic\nPERSONAL INFORMATION\nFirst Name: Different');
  assert.equal(conflicts(state).length, 1);
  assert.equal(conflicts(state)[0].sources.length, 2);
  assert.equal(get(state, 'personal.first-name').readiness, 'blocked');
});

test('invalid duplicates cannot become ready and date precision is not erased', () => {
  const invalid = session('PERSONAL INFORMATION\nPhone Number: 123\nPhone Number: 123');
  assert.equal(get(invalid, 'personal.phone-number').readiness, 'blocked');
  const dates = session('BIRTH INFORMATION\nDate of Birth: 2000-01\nDate of Birth: 2000-01-01');
  assert.equal(conflicts(dates).length, 1);
});
