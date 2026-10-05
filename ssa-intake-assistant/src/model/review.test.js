import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientProfile } from './client-schema.js';
import { validateProfile, profileCanBeMarkedReady, isImpossibleDate } from './validation.js';
import { editAnswer, confirmAnswer, markProfileReady, phaseOneRequiredPaths, getField } from './review.js';

test('edits reset confirmation and readiness without changing the source profile', () => {
  const original = createClientProfile();
  const path = 'personal.firstName';
  const entered = editAnswer(original, path, 'Example');
  const confirmed = confirmAnswer(entered, path, true);
  const edited = editAnswer({ ...confirmed, ready: true }, path, 'Sample');
  assert.equal(getField(original, path).value, '');
  assert.equal(getField(confirmed, path).status, 'confirmed');
  assert.equal(getField(edited, path).employeeConfirmed, false);
  assert.equal(getField(edited, path).status, 'needs_review');
  assert.equal(edited.ready, false);
});

test('readiness requires every required answer to be confirmed', () => {
  let profile = createClientProfile();
  for (const path of phaseOneRequiredPaths) profile = confirmAnswer(editAnswer(profile, path, 'Example'), path, true);
  assert.equal(profileCanBeMarkedReady(profile, phaseOneRequiredPaths), true);
  assert.equal(markProfileReady(profile).ready, true);
  assert.equal(markProfileReady(editAnswer(profile, 'personal.lastName', '')).ready, false);
  assert.deepEqual(validateProfile(profile), []);
  assert.equal(isImpossibleDate('11/30/-0001'), true);
});
