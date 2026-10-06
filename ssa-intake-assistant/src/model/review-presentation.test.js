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
