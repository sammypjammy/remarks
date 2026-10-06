import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake } from '../intake-checker/parser.js';
import { createIntakeSession } from '../intake-checker/session.js';
import { fromIntakeChecker } from '../ssa-intake-assistant/src/model/from-intake-checker.js';
import { readyFields } from '../ssa-intake-assistant/src/model/intake-contract.js';
const profile = text => fromIntakeChecker(createIntakeSession(parseIntake(text)));
const field = (p, id) => p.fields.find(item => item.id === id);

test('unparsed record text blocks that record, not personal answers or a sibling record', () => {
  const text = 'PERSONAL INFORMATION\r\nFirst Name: Synthetic\r\nMEDICAL PROVIDERS\r\nClinic 1\r\nClinic Name: Synthetic One\r\nUnknown question: Synthetic answer\r\nClinic 2\r\nClinic Name: Synthetic Two';
  const p = profile(text);
  assert.equal(field(p, 'personal.first-name').readiness, 'ready');
  assert.equal(field(p, 'providers.clinic-name@providers-1').readiness, 'blocked');
  assert.equal(field(p, 'providers.clinic-name@providers-2').readiness, 'ready');
  const issue = p.validationIssues.find(issue => issue.code === 'parsing');
  assert.equal(issue.scopePath, '/1/0');
  assert.equal(issue.line, 6);
  assert.equal(text.slice(issue.sources[0].start, issue.sources[0].end), 'Unknown question: Synthetic answer');
  assert.equal(field(p, 'providers.clinic-name@providers-1').correctionTarget, null);
});

test('unscoped preface stays an unresolved requirement without manufacturing field errors', () => {
  const p = profile('Synthetic preface\nPERSONAL INFORMATION\nFirst Name: Synthetic');
  assert.equal(field(p, 'personal.first-name').readiness, 'ready');
  assert(p.requirements.some(issue => issue.code === 'parsing' && issue.scopePath === null));
  assert.equal(p.unparsed[0].text, 'Synthetic preface');
});

test('parent-section parsing uncertainty also covers its descendants', () => {
  const p = profile('MEDICAL PROVIDERS\nUnknown question: Synthetic\nClinic 1\nClinic Name: Synthetic\nPERSONAL INFORMATION\nFirst Name: Synthetic');
  assert.equal(field(p, 'providers.clinic-name@providers-1').readiness, 'blocked');
  assert.equal(field(p, 'personal.first-name').readiness, 'ready');
});

test('parsing errors cannot be dismissed into readiness and disappear only after source repair', () => {
  const text = 'PERSONAL INFORMATION\nFirst Name: Synthetic\nUnknown question: Synthetic';
  const s = createIntakeSession(parseIntake(text));
  s.report.issues.forEach(s.validationState.review);
  assert.equal(field(fromIntakeChecker(s), 'personal.first-name').readiness, 'blocked');
  assert.equal(field(profile(text.replace('Unknown question', 'Last Name')), 'personal.first-name').readiness, 'ready');
});

test('unrelated missing fields remain correctable; previous contract consumers must reject new semantics', () => {
  const p = profile('PERSONAL INFORMATION\nFirst Name: Synthetic\nEmail: Not provided\nMEDICAL PROVIDERS\nClinic 1\nUnknown question: Synthetic');
  assert(field(p, 'personal.email').correctionTarget);
  assert.equal(p.schemaVersion, '3.0.0');
  assert.deepEqual(readyFields({ ...p, schemaVersion: '2.0.0' }), []);
});
