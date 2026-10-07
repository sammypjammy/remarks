import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake } from '../../../intake-checker/parser.js';
import { createIntakeSession, correctIntakeField } from '../../../intake-checker/session.js';
import { fromIntakeChecker } from './from-intake-checker.js';
import { readyFields } from './intake-contract.js';
import { reviewPresentation } from './review-presentation.js';
const session = text => createIntakeSession(parseIntake(text));

test('ignored errors disappear from presentation without changing values or readiness', () => {
  const s = session('PERSONAL INFORMATION\nFirst Name: 123\nEmail: Not provided\nMiddle Name: Synthetic\nMiddle Name: Different');
  s.report.issues.forEach(s.validationState.review);
  const profile = fromIntakeChecker(s), before = JSON.stringify(profile);
  const view = reviewPresentation(profile);
  for (const id of ['personal.first-name','personal.email','personal.middle-name']) {
    assert(!view.blocked.some(field => field.id === id));
    assert(view.ignored.some(field => field.id === id));
    assert(!readyFields(profile).some(field => field.id === id));
  }
  assert.equal(JSON.stringify(profile), before);
  assert.equal(view.requirements.length, 0);
});

test('ignored parsing notices and reviewed general flags do not reappear', () => {
  const s = session('PERSONAL INFORMATION\nFirst Name: Synthetic\nUnknown question: Synthetic\nEMPLOYMENT INFORMATION\nCurrently working: Yes');
  s.report.issues.filter(issue => issue.code === 'parsing').forEach(s.validationState.review);
  s.review.items.forEach(s.reviewState.review);
  for (let i = 0; i < 2; i++) {
    const view = reviewPresentation(fromIntakeChecker(s));
    assert.equal(view.parsingIssues.length, 0);
    assert.equal(view.reviews.length, 0);
    assert(!view.blocked.some(field => field.id === 'personal.first-name'));
  }
});

test('remaining independent issues stay visible when another issue was ignored', () => {
  const s = session('MEDICAL PROVIDERS\nClinic 1\nFirst Visit Date: 2000-02-01\nLast Visit Date: 2000-01-01');
  s.report.issues.filter(issue => issue.field === 'First Visit Date').forEach(s.validationState.review);
  const view = reviewPresentation(fromIntakeChecker(s));
  assert(!view.blocked.some(field => field.id === 'providers.first-visit-date@providers-1'));
  assert(view.blocked.some(field => field.id === 'providers.last-visit-date@providers-1'));
});

test('related corrections and rechecking restore attention without restoring unrelated dismissals', () => {
  const text = 'PERSONAL INFORMATION\nFirst Name: 123\nEmail: Not provided';
  const s = session(text);
  s.report.issues.forEach(s.validationState.review);
  const target = fromIntakeChecker(s).fields.find(field => field.id === 'personal.first-name').correctionTarget;
  assert(correctIntakeField(s, target, '456'));
  const view = reviewPresentation(fromIntakeChecker(s));
  assert(view.blocked.some(field => field.id === 'personal.first-name'));
  assert(!view.blocked.some(field => field.id === 'personal.email'));
  assert(reviewPresentation(fromIntakeChecker(session(text))).blocked.some(field => field.id === 'personal.email'));
});

test('optional blanks and unsupported answers do not create another review task', () => {
  const s = session('PERSONAL INFORMATION\nFirst Name: Synthetic\nMiddle Name: Not provided\nSuffix: Not provided\nNickname: Not provided\n**Unknown question:** Synthetic');
  s.report.issues.forEach(s.validationState.review);
  s.review.items.forEach(s.reviewState.review);
  const profile = fromIntakeChecker(s), before = JSON.stringify(profile);
  assert.equal(reviewPresentation(profile).blocked.length, 0);
  for (const id of ['personal.middle-name', 'personal.suffix', 'personal.nickname']) {
    assert.equal(profile.fields.find(field => field.id === id).readiness, 'blocked');
    assert(!readyFields(profile).some(field => field.id === id));
  }
  assert(profile.fields.some(field => field.category === 'unsupported'));
  assert.equal(JSON.stringify(profile), before);
});

test('schema-only limitations never produce attention without Checker issues', () => {
  const profile = fromIntakeChecker(session('PERSONAL INFORMATION\nMiddle Name: Not provided\n**Unknown question:** Synthetic'));
  const fields = profile.fields.filter(field => !field.validation.issues.length);
  assert(fields.some(field => field.readiness === 'blocked'));
  assert.equal(reviewPresentation({ ...profile, fields }).blocked.length, 0);
});

test('missing optional prior-spouse values remain visible on their record without duplicate attention tasks', () => {
  const s = session('MARRIAGE INFORMATION\nPrevious Spouse 1\nFirst Name: Former');
  const profile = fromIntakeChecker(s);
  const prior = profile.fields.filter(field => field.category === 'priorSpouses');
  assert.equal(prior.length, 18);
  assert(prior.some(field => field.label === 'Marriage End Date' && field.value === null));
  assert(!reviewPresentation(profile).blocked.some(field => field.category === 'priorSpouses'));
});

test('a passing Checker intake with optional blanks needs no SSA review', async () => {
  const { completeSyntheticIntake } = await import('../../tests/complete-intake.mjs');
  const text = completeSyntheticIntake().replace('**Middle Name:** Synthetic', '**Middle Name:** Not provided').replace('**Suffix:** Synthetic', '**Suffix:** Not provided').replace('**Nickname:** Synthetic', '**Nickname:** Not provided') + '\n## CUSTOM\n**Unmapped question:** Synthetic';
  const s = session(text);
  assert.equal(s.report.issues.length, 0);
  s.review.items.forEach(s.reviewState.review);
  const view = reviewPresentation(fromIntakeChecker(s));
  assert.equal(view.blocked.length + view.requirements.length + view.parsingIssues.length + view.reviews.length, 0);
  assert.equal(view.ignored.length, 0);
});
