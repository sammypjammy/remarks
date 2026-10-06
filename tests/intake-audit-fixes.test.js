import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake, sourceRange } from '../intake-checker/parser.js';
import { createIntakeSession, correctIntakeField } from '../intake-checker/session.js';
import { fromIntakeChecker } from '../ssa-intake-assistant/src/model/from-intake-checker.js';
import { distinctMedicalProblemCount } from '../intake-checker/medical-problems.js';
const state = text => createIntakeSession(parseIntake(text));
const profileField = (s, id) => fromIntakeChecker(s).fields.find(field => field.id === id);
function edit(s, section, label, value, path) {
  let node = s.parsed.sections.find(item => item.title === section);
  const nodePath = path || '/' + s.parsed.sections.indexOf(node);
  if (path) { for (const part of path.split('/').slice(2)) node = node.subsections[Number(part)]; }
  const field = node.fields.find(item => item.label === label);
  assert(correctIntakeField(s, { section, label, nodePath, range: sourceRange(field) }, value));
}

test('medical duplicates merge across labels with all provenance and no fuzzy merging', () => {
  const text = 'MEDICAL PROBLEMS\nProblem one: Synthetic condition alpha\nProblem 2: Synthetic condition alpha\nProblem three: Synthetic condition beta\nProblem 4: synthetic condition alpha';
  const s = state(text), before = JSON.stringify(s.parsed);
  const fields = fromIntakeChecker(s).fields.filter(field => field.category === 'medical-problems');
  assert.equal(fields.length, 3);
  assert.equal(distinctMedicalProblemCount(s.parsed), 3);
  assert.equal(fields[0].sources.length, 2);
  assert.deepEqual(fields[0].sources.map(source => source.label), ['Problem one', 'Problem 2']);
  assert(fields[0].sources.every(source => text.slice(source.range.start, source.range.end).includes(source.rawValue)));
  assert.equal(JSON.stringify(s.parsed), before);
});

test('medical missing answers and conflicts remain blocked instead of being merged away', () => {
  const s = state('MEDICAL PROBLEMS\nProblem one: Synthetic alpha\nProblem one: Synthetic beta\nProblem two: Synthetic alpha\nProblem three: Not provided');
  const fields = fromIntakeChecker(s).fields.filter(field => field.category === 'medical-problems');
  assert.equal(fields.length, 3);
  assert(fields[0].blockingReasons.some(reason => reason.code === 'conflict'));
  assert(fields[2].blockingReasons.some(reason => reason.code === 'missing'));
  assert.equal(fields[0].sources.length, 2);
});

test('medical >10 warning counts distinct exact values, not occurrences', () => {
  const repeated = 'MEDICAL PROBLEMS\n' + Array.from({ length: 11 }, (_, i) => 'Problem ' + (i + 1) + ': Synthetic same').join('\n');
  assert(!state(repeated).review.items.some(item => item.message === 'More Than 10 Conditions'));
  const distinct = 'MEDICAL PROBLEMS\n' + Array.from({ length: 11 }, (_, i) => 'Problem ' + (i + 1) + ': Synthetic ' + i).join('\n');
  assert(state(distinct).review.items.some(item => item.message === 'More Than 10 Conditions'));
});

for (const never of ['No', 'false']) test('never-worked exemption survives grouped missing fields: ' + never, () => {
  const s = state('EMPLOYMENT INFORMATION\nHave you ever worked: ' + never);
  const profile = fromIntakeChecker(s);
  assert(!profile.fields.some(field => field.definitionId === 'employment.when-did-you-last-work'));
  assert.equal(profileField(s, 'employment.have-you-ever-worked').readiness, 'ready');
  assert(profileField(s, 'employment.currently-working').blockingReasons.some(reason => reason.code === 'missing'));
});

test('both reversed dates block; fixing one date reevaluates both fields', () => {
  const s = state('MEDICAL PROVIDERS\nClinic 1\nFirst Visit Date: 2001-01-01\nLast Visit Date: 2000-01-01');
  for (const id of ['first-visit-date', 'last-visit-date']) assert.equal(profileField(s, 'providers.' + id + '@providers-1').readiness, 'blocked');
  edit(s, 'MEDICAL PROVIDERS', 'First Visit Date', '1999-01-01', '/0/0');
  for (const id of ['first-visit-date', 'last-visit-date']) assert.equal(profileField(s, 'providers.' + id + '@providers-1').readiness, 'ready');
});

test('unknown plain labels are not appended to the preceding answer and are red with source locations', () => {
  const text = 'PERSONAL INFORMATION\r\nFirst Name: Synthetic\r\nUnknown question: Synthetic answer\r\nLast Name: Example';
  const s = state(text);
  assert.equal(s.parsed.sections[0].fields[0].value, 'Synthetic');
  const issue = s.report.issues.find(issue => issue.section === 'PARSING');
  assert.equal(issue.severity, 'error');
  assert.equal(text.slice(issue.sources[0].start, issue.sources[0].end), 'Unknown question: Synthetic answer');
  s.report.issues.forEach(s.validationState.review);
  assert.equal(profileField(s, 'personal.first-name').readiness, 'blocked');
});

test('ordinary multiline free text stays unchanged and unparseable prefaces are red', () => {
  const s = state('Synthetic preface\nREMARKS/COMMENTS\nRemarks/Comments: First line\nSecond line');
  assert.equal(s.parsed.sections[0].fields[0].value, 'First line\nSecond line');
  assert(s.report.issues.some(issue => issue.section === 'PARSING' && issue.severity === 'error'));
});

test('onset edits reset failed-work dismissal but preserve unrelated review dismissals', () => {
  const s = state('DISABILITY INFORMATION\nOnset date of disability: 2000-01-01\nWORK HISTORY\nJob 1\nStart Date: 2001-01-01\nEnd Date: 2001-02-01\nEmployer: Synthetic\nOTHER NAMES\nUsed other names in medical records: Yes');
  s.review.items.forEach(s.reviewState.review);
  edit(s, 'WORK HISTORY', 'Employer', 'Synthetic Other', '/1/0');
  assert.equal(s.reviewState.remaining().length, 0);
  edit(s, 'DISABILITY INFORMATION', 'Onset date of disability', '2000-02-01');
  assert.deepEqual(s.reviewState.remaining().map(item => item.message), ['Failed Work Attempt — Job 1']);
});

test('provider unrelated edits preserve dismissed date warning; related edits restore it', () => {
  const s = state('MEDICAL PROVIDERS\nClinic 1\nFirst Visit Date: 01/2000\nLast Visit Date: 01/2000\nPhone Number: 202-555-0142');
  s.report.issues.filter(issue => issue.severity === 'warning').forEach(s.validationState.review);
  edit(s, 'MEDICAL PROVIDERS', 'Phone Number', '202-555-0143', '/0/0');
  assert(!s.validationState.remaining().some(issue => issue.severity === 'warning'));
  edit(s, 'MEDICAL PROVIDERS', 'First Visit Date', '01/02/2000', '/0/0');
  assert(s.validationState.remaining().some(issue => issue.severity === 'warning'));
});

test('income amount edits preserve the general dismissal; answer edits restore it', () => {
  const s = state('FINANCIAL SUPPORT\nVeteran Benefits - Receive Veteran Benefits: Yes\nVeteran Benefits - Monthly amount: $10');
  s.review.items.forEach(s.reviewState.review);
  edit(s, 'FINANCIAL SUPPORT', 'Veteran Benefits - Monthly amount', '$20');
  assert.equal(s.reviewState.remaining().length, 0);
  edit(s, 'FINANCIAL SUPPORT', 'Veteran Benefits - Receive Veteran Benefits', 'true');
  assert.equal(s.reviewState.remaining()[0].message, 'Receiving income');
});
