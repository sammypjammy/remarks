import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake, sourceRange } from '../intake-checker/parser.js';
import { createIntakeSession } from '../intake-checker/session.js';
import { fromIntakeChecker } from '../ssa-intake-assistant/src/model/from-intake-checker.js';
const header = 'Print as PDF\nIntake Form\nSynthetic Example\nGenerated on October 5, 2026 at 5:33 PM\n\n';
for (const ending of ['\n', '\r\n']) test('observed export header is metadata, with original source offsets: ' + JSON.stringify(ending), () => {
  const text = (header + 'PERSONAL INFORMATION\nFirst Name:\nSynthetic\nLast Name:\nExample').replaceAll('\n', ending);
  const parsed = parseIntake(text);
  assert.equal(parsed.unparsed.length, 0);
  assert.equal(parsed.sections[0].fields.length, 2);
  const range = sourceRange(parsed.sections[0].fields[0]);
  assert.equal(text.slice(range.start, range.end), 'First Name:' + ending + 'Synthetic');
  const profile = fromIntakeChecker(createIntakeSession(parsed));
  assert.equal(profile.fields.find(field => field.id === 'personal.first-name').readiness, 'ready');
  assert(!profile.validationIssues.some(issue => issue.code === 'parsing'));
  assert(!profile.fields.some(field => field.sources.some(source => source.rawValue?.includes('Generated on'))));
});

test('unknown questions after header still need source review, with unchanged line numbers', () => {
  const parsed = parseIntake(header + 'PERSONAL INFORMATION\nFirst Name: Synthetic\nUnknown question: Synthetic');
  assert.equal(parsed.unparsed.length, 1);
  assert.equal(parsed.unparsed[0].line, 8);
});

test('header name is never used to fill missing identity answers', () => {
  const profile = fromIntakeChecker(createIntakeSession(parseIntake(header + 'PERSONAL INFORMATION\nFirst Name: Not provided')));
  const field = profile.fields.find(field => field.id === 'personal.first-name');
  assert.equal(field.value, null);
  assert.equal(field.readiness, 'blocked');
});

test('lookalike unknown content and in-answer text are not silently removed', () => {
  const parsed = parseIntake(header.replace('Synthetic Example', 'Unknown question: Synthetic') + 'PERSONAL INFORMATION\nFirst Name: Synthetic');
  assert(parsed.unparsed.length > 0);
  const notes = parseIntake('REMARKS/COMMENTS\nRemarks/Comments: Print as PDF\nIntake Form');
  assert.equal(notes.sections[0].fields[0].value, 'Print as PDF\nIntake Form');
});

test('unmapped standalone question labels retain their answers without a parsing cascade', () => {
  const text = 'DISABILITY INFORMATION\nOver 62 - Want reduced retirement benefits:\nNot provided\nFiled for disability in the past:\nNo\nLast applied for disability:\nNot provided\nLast denial date:\nNot provided\nType of prior denial:\nNot provided\nOnset date of disability:\n2000-01-01';
  const parsed = parseIntake(text);
  assert.equal(parsed.unparsed.length, 0);
  assert.equal(parsed.sections[0].fields.length, 6);
  assert.equal(parsed.sections[0].fields[1].value, 'No');
  const profile = fromIntakeChecker(createIntakeSession(parsed));
  assert(!profile.validationIssues.some(issue => issue.code === 'parsing'));
  assert.equal(profile.fields.find(field => field.definitionId === 'disability.onset-date-of-disability').readiness, 'ready');
  const unsupported = profile.fields.filter(field => field.category === 'unsupported');
  assert.equal(unsupported.length, 5);
  assert(unsupported.every(field => field.readiness === 'blocked'));
  assert.equal(unsupported.find(field => field.label === 'Filed for disability in the past').value, 'No');
  for (const field of unsupported) for (const source of field.sources) assert(text.slice(source.range.start, source.range.end).startsWith(source.label + ':'));
});

test('unknown standalone labels without a containing section still require parsing review', () => {
  assert.equal(parseIntake('Unknown question:\nSynthetic answer').unparsed.length, 2);
});
