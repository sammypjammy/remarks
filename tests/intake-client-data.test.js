import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientData, CLIENT_DATA_SCHEMA, CLIENT_DATA_VERSION } from '../intake-checker/client-data.js';
import { fieldDefinitions, INTAKE_CHECKER_VERSION } from '../intake-checker/field-catalog.js';
import { intakeRules } from '../intake-checker/rules.js';
import { reviewFields } from '../intake-checker/review-fields.js';
import { parseIntake } from '../intake-checker/parser.js';
import { createIntakeSession, correctIntakeField } from '../intake-checker/session.js';
import { fromIntakeChecker } from '../ssa-intake-assistant/src/model/from-intake-checker.js';
import { syntheticValue } from './synthetic-intake-values.js';
import { readFileSync } from 'node:fs';

const session = text => createIntakeSession(parseIntake(text));
const field = (data, id) => data.fields.find(item => item.definitionId === id);
function allFieldsFixture() {
  const groups = new Map(), records = { vehicles: 'Vehicle 1', providers: 'Clinic 1', medications: 'Medication 1', jobs: 'Job 1', spouse: 'Current Spouse', priorSpouses: 'Previous Spouse 1', children: 'Child 1' };
  for (const definition of fieldDefinitions) {
    const key = definition.section + (definition.record ? '/' + definition.category : '');
    const group = groups.get(key) || { section: definition.section, heading: definition.record ? records[definition.category] : null, fields: [] };
    const value = definition.label === 'Prior spouse died since marriage ended' ? 'Unknown'
      : definition.dataType === 'boolean' ? 'No' : definition.label === 'Next Visit Date' ? '2099-01-01' : syntheticValue(definition.label, 'Synthetic');
    group.fields.push(`${definition.label}: ${value}`); groups.set(key, group);
  }
  // Group records under the SAME root when singleton and record definitions coexist.
  const sections = new Map();
  for (const group of groups.values()) {
    const blocks = sections.get(group.section) || [];
    blocks.push((group.heading ? `#### ${group.heading}\n` : '') + group.fields.join('\n'));
    sections.set(group.section, blocks);
  }
  return [...sections].map(([title, blocks]) => `## ${title}\n${blocks.join('\n')}`).join('\n') + '\nMEDICAL PROBLEMS\nProblem one: Synthetic condition';
}

test('catalog includes every configured field and every supplemental parser/review label with stable unique IDs', () => {
  assert.equal(fieldDefinitions.length, 138);
  assert.equal(new Set(fieldDefinitions.map(item => item.id)).size, 138);
  for (const [section, rule] of Object.entries(intakeRules.sections)) for (const label of [...rule.required, ...(rule.optional || [])]) {
    assert(fieldDefinitions.some(item => item.section === section && item.label === label && !item.record), `${section} / ${label}`);
  }
  for (const [category, rule] of Object.entries(intakeRules.records)) for (const label of [...rule.required, ...(rule.optional || []), ...(rule.currentYearAddress || []), ...(rule.recognition || [])]) {
    assert(fieldDefinitions.some(item => item.category === category && item.label === label && item.record), `${category} / ${label}`);
  }
  for (const label of [...reviewFields, 'Last Visit Date', 'Have you ever worked', 'Used other names in medical records', 'Other first name', 'Other last name', 'Remarks/Comments']) assert(fieldDefinitions.some(item => item.label === label), label);
});

test('complete synthetic intake represents all 138 definitions and every parsed occurrence exactly once', () => {
  const state = session(allFieldsFixture()), before = JSON.stringify(state.parsed);
  const data = createClientData(state);
  assert.equal(data.schema, CLIENT_DATA_SCHEMA); assert.equal(data.schemaVersion, '1.0.0');
  assert.equal(CLIENT_DATA_VERSION, '1.0.0'); assert.equal(data.toolVersion, INTAKE_CHECKER_VERSION);
  for (const definition of fieldDefinitions) assert(data.fields.some(item => item.definitionId === definition.id && item.parsed), definition.id);
  assert.equal(data.coverage.parsedOccurrences, 139);
  assert.equal(data.coverage.preservedOccurrences, 139);
  assert.equal(data.coverage.unmappedFields, 0);
  assert.equal(new Set(data.fields.map(item => item.id)).size, data.fields.length);
  assert.equal(JSON.stringify(state.parsed), before);
  assert.deepEqual(data, JSON.parse(JSON.stringify(data)));
  assert.deepEqual(data, createClientData(state));
  assert.equal(field(data, 'employment.currently-working').value, false);
  assert.equal(field(data, 'personal.phone-number').value, '202-555-0142');
});

test('actual work-history records retain supported employment values, identities, provenance and corrections', () => {
  const text = `WORK HISTORY
Most Recent Job
Job Title: Synthetic
Employer: Fictional Recent Co
Business Type: Example
Start Date: 2010-01-02
End Date: 2015-06-07
Hours per Day: 8
Days per Week: 5
Rate of Pay: $10.00
Pay Frequency: Monthly
Address: 123 Fictional Work Road
City: Sample City
State: EX
Zipcode: 00000
Previous Job
Job Title: Synthetic
Employer: Fictional Previous Co
Business Type: Example
Start Date: 2001-02-03
End Date: 2009-12-31
Hours per Day: 8
Days per Week: 5
Rate of Pay: $10.00
Pay Frequency: Monthly`;
  const state = session(text), data = createClientData(state);
  const jobs = data.scopes.filter(scope => scope.recordTypes.includes('jobs'));
  assert.equal(jobs.length, 2);
  assert(jobs.every(scope => scope.parsed && scope.source && scope.fieldIds.length));
  const mapped = ['jobs.job-title', 'jobs.employer', 'jobs.business-type', 'jobs.address', 'jobs.city', 'jobs.state',
    'jobs.zipcode', 'jobs.hours-per-day', 'jobs.days-per-week', 'jobs.rate-of-pay', 'jobs.pay-frequency',
    'jobs.start-date', 'jobs.end-date'];
  for (const definitionId of mapped) {
    const matches = data.fields.filter(item => item.definitionId === definitionId);
    assert.equal(matches.length, 2, definitionId);
    assert.deepEqual(matches.map(item => item.recordId), jobs.map(scope => scope.id));
    assert(matches.every(item => item.supported && item.validation && item.review && item.recordSource));
  }
  const firstEmployer = data.fields.find(item => item.definitionId === 'jobs.employer' && item.scopeId === jobs[0].id);
  const employerSource = firstEmployer.occurrences[0].source;
  assert.equal(text.slice(employerSource.start, employerSource.end), 'Employer: Fictional Recent Co');
  assert.equal(firstEmployer.occurrences[0].originalValue, 'Fictional Recent Co');
  assert.equal(firstEmployer.occurrences[0].currentValue, 'Fictional Recent Co');
  assert(correctIntakeField(state, {
    nodePath: jobs[0].nodePath, section: 'WORK HISTORY', label: 'Employer',
    range: employerSource,
  }, 'Corrected Fictional Co'));
  const corrected = createClientData(state).fields.find(item => item.definitionId === 'jobs.employer' && item.scopeId === jobs[0].id);
  assert.equal(corrected.value, 'Corrected Fictional Co');
  assert.equal(corrected.origin, 'employee_entered');
  assert.equal(corrected.occurrences[0].originalValue, 'Fictional Recent Co');
  assert.equal(corrected.occurrences[0].currentValue, 'Corrected Fictional Co');
  assert.deepEqual(corrected.occurrences[0].corrections.map(change => change.value), ['Corrected Fictional Co']);
  assert.equal(corrected.validation.hasErrors, false);
  assert.deepEqual(corrected.review.reviewedIds, []);

  const reviewedSession = session(`DISABILITY INFORMATION
Onset date of disability: 2020-01-01
WORK HISTORY
Job 1
Start Date: 2020-02-01
End Date: 2020-03-01`);
  const failedAttempt = reviewedSession.review.items.find(item => item.message.startsWith('Failed Work Attempt'));
  assert(failedAttempt);
  reviewedSession.reviewState.review(failedAttempt);
  const reviewedData = createClientData(reviewedSession);
  const reviewedStart = reviewedData.fields.find(item => item.definitionId === 'jobs.start-date');
  assert(reviewedStart.review.itemIds.includes('review-0'));
  assert(reviewedStart.review.reviewedIds.includes('review-0'));
});

test('no work-history record creates no job scope; missing fields on an actual job remain explicit', () => {
  const empty = createClientData(session('WORK HISTORY\nHave you ever worked: Yes'));
  assert.equal(empty.scopes.some(scope => scope.recordTypes.includes('jobs')), false);
  const data = createClientData(session('WORK HISTORY\nJob 1\nEmployer: Fictional Co'));
  const job = data.scopes.find(scope => scope.recordTypes.includes('jobs'));
  assert(job);
  for (const definitionId of ['jobs.address', 'jobs.city', 'jobs.state', 'jobs.zipcode', 'jobs.start-date', 'jobs.end-date']) {
    const field = data.fields.find(item => item.definitionId === definitionId && item.scopeId === job.id);
    assert(field, definitionId);
    assert.equal(field.valueStatus, 'missing', definitionId);
    assert.equal(field.parsed, false, definitionId);
    assert.equal(field.recordId, job.id, definitionId);
  }
});

test('original document metadata, UTF-16 CRLF offsets, raw values, unknown multiline fields and scoped unparsed lines survive', () => {
  const text = 'Print as PDF\r\nIntake Form\r\nSynthetic Example\r\nGenerated on October 5, 2026 at 5:33 PM\r\n\r\nPERSONAL INFORMATION\r\nFirst Name: SYNTHÉTIC\r\nCustom note:\r\nFictional emoji 😀\r\nsecond line\r\nUnknown inline: keep as unparsed';
  const data = createClientData(session(text));
  assert.equal(data.source.text, text);
  assert(text.slice(data.source.documentHeaderRange.start, data.source.documentHeaderRange.end).startsWith('Print as PDF'));
  const name = field(data, 'personal.first-name');
  assert.equal(name.value, 'Synthétic'); assert.equal(name.occurrences[0].originalValue, 'SYNTHÉTIC');
  assert.equal(text.slice(name.occurrences[0].source.start, name.occurrences[0].source.end), 'First Name: SYNTHÉTIC');
  const note = data.fields.find(item => item.label === 'Custom note');
  assert.equal(note.value, 'Fictional emoji 😀\nsecond line'); assert.equal(note.valueStatus, 'uninterpreted');
  assert.equal(data.unparsed.length, 1); assert(data.unparsed[0].scopeId);
  assert.equal(text.slice(data.unparsed[0].source.start, data.unparsed[0].source.end), data.unparsed[0].text);
  assert(name.validation.unresolvedIssueIds.some(id => data.validationIssues.find(issue => issue.id === id).code === 'parsing'));
});

test('missing, invalid formats, ambiguous answers and ordinary false/zero/free text remain distinct', () => {
  const data = createClientData(session('PERSONAL INFORMATION\nFirst Name: Not provided\nMiddle Name:\nPhone Number: 123\nBIRTH INFORMATION\nDate of Birth: 02/30/2000\nEMPLOYMENT INFORMATION\nCurrently working: Sometimes\nHave you ever worked: No\nVITALS\nHeight (inches): 0\nREMARKS/COMMENTS\nRemarks/Comments: NOT changed! 42.'));
  assert.equal(field(data, 'personal.first-name').valueStatus, 'missing');
  assert.equal(field(data, 'personal.last-name').parsed, false);
  assert.equal(field(data, 'personal.middle-name').parsed, true);
  assert.equal(field(data, 'personal.phone-number').valueStatus, 'invalid');
  assert.equal(field(data, 'personal.phone-number').occurrences[0].currentValue, '123');
  assert.equal(field(data, 'birth.date-of-birth').value, null);
  assert.equal(field(data, 'birth.date-of-birth').valueStatus, 'invalid');
  assert.equal(field(data, 'employment.currently-working').valueStatus, 'ambiguous');
  assert.equal(field(data, 'employment.have-you-ever-worked').value, false);
  assert.equal(field(data, 'vitals.height-inches').value, '0');
  assert.equal(field(data, 'remarks.remarks-comments').value, 'NOT changed! 42.');
});

test('duplicates preserve all sources; conflicts and repeated singleton subjects cannot choose an answer', () => {
  let data = createClientData(session('PERSONAL INFORMATION\nFirst Name: SYNTHETIC\nFirst Name: Synthetic'));
  assert.equal(field(data, 'personal.first-name').value, 'Synthetic');
  assert.equal(field(data, 'personal.first-name').occurrences.length, 2);
  for (const other of ['Different', 'Not provided']) {
    data = createClientData(session(`PERSONAL INFORMATION\nFirst Name: Synthetic\nFirst Name: ${other}`));
    assert.equal(field(data, 'personal.first-name').value, null);
    assert.equal(field(data, 'personal.first-name').valueStatus, 'conflict');
  }
  data = createClientData(session('PERSONAL INFORMATION\nFirst Name: Synthetic\nPERSONAL INFORMATION\nFirst Name: Synthetic'));
  const names = data.fields.filter(item => item.definitionId === 'personal.first-name');
  assert.equal(names.length, 2); assert(names.every(item => item.valueStatus === 'ambiguous' && item.value === null));
});

test('repeating records, nested fields and each numbered medical source are lossless, with no hypothetical records', () => {
  const data = createClientData(session('MEDICAL PROVIDERS\nClinic 1\nClinic Name: Synthetic\n#### Clinic 1\nClinic Name: Synthetic\nCHILDREN INFORMATION\n#### Child A\nFirst Name: Synthetic\n##### Child A\nFirst Name: Synthetic\nMEDICAL PROBLEMS\nProblem one: Synthetic condition\nProblem 2: Synthetic condition\nProblem 21: Another synthetic condition\n#### Group\nProblem 22: Not provided\nVEHICLES\nVehicle 1\nMake: Synthetic'));
  assert.equal(data.coverage.parsedOccurrences, data.coverage.preservedOccurrences);
  for (const id of ['providers.clinic-name', 'children.first-name']) {
    const fields = data.fields.filter(item => item.definitionId === id);
    assert.equal(fields.length, 2); assert.notEqual(fields[0].recordId, fields[1].recordId);
  }
  assert.equal(data.fields.filter(item => item.definitionId === 'medical-problems.problem').length, 4);
  assert.equal(data.derived.distinctMedicalProblemCount, 2);
  assert(!data.fields.some(item => item.category === 'jobs'));
  assert.equal(field(data, 'vehicles.make').value, 'Synthetic');
});

test('plain child records preserve supported names, independent identity, sources and validation state', () => {
  const text = `CHILDREN INFORMATION
Child 1
First Name: 123
Last Name: Fictional One
Child 2
First Name: Synthetic Two
Last Name: Example Two`;
  const data = createClientData(session(text));
  const firstNames = data.fields.filter(item => item.definitionId === 'children.first-name');
  const lastNames = data.fields.filter(item => item.definitionId === 'children.last-name');
  assert.equal(firstNames.length, 2);
  assert.equal(lastNames.length, 2);
  assert(firstNames.every(item => item.supported && item.valueStatus !== 'uninterpreted'));
  assert(lastNames.every(item => item.supported && item.valueStatus !== 'uninterpreted'));
  assert.notEqual(firstNames[0].recordId, firstNames[1].recordId);
  assert.deepEqual(firstNames.map(item => item.value), [null, 'Synthetic Two']);
  assert.equal(firstNames[0].valueStatus, 'invalid');
  assert(firstNames[0].validation.hasErrors);
  assert(firstNames[1].validation.hasErrors === false);
  for (const item of [...firstNames, ...lastNames]) {
    const occurrence = item.occurrences[0];
    assert.equal(text.slice(occurrence.source.start, occurrence.source.end), `${item.label}: ${occurrence.currentValue}`);
    assert.equal(item.recordId, data.scopes.find(scope => scope.id === item.scopeId).id);
  }
  assert.equal(data.coverage.unmappedFields, 0);
  assert.equal(data.unparsed.length, 0);
});

test('numbered previous spouses preserve each actual record, fields, source locations, Unknown, and corrections', () => {
  const text = `MARRIAGE INFORMATION
Marital Status: Single
Previous Spouse 1
First Name: Former One
Middle Name: Initial
Name at Birth: Birth Name
Prior spouse died since marriage ended: UNKNOWN
Previous Spouse 2
First Name: Former Two`;
  const state = session(text);
  const data = createClientData(state);
  const first = data.fields.find(item => item.definitionId === 'priorSpouses.first-name'
    && data.scopes.find(scope => scope.id === item.recordId)?.title === 'Previous Spouse 1');
  const second = data.fields.find(item => item.definitionId === 'priorSpouses.first-name'
    && data.scopes.find(scope => scope.id === item.recordId)?.title === 'Previous Spouse 2');
  assert(first && second);
  assert.notEqual(first.recordId, second.recordId);
  assert.equal(first.supported, true);
  assert.equal(second.supported, true);
  assert.equal(first.value, 'Former One');
  assert.equal(second.value, 'Former Two');
  assert.notEqual(first.recordId, second.recordId);
  const recordFields = data.fields.filter(item => item.category === 'priorSpouses');
  assert.equal(recordFields.length, 36);
  assert(recordFields.filter(item => item.recordId === first.recordId).every(item => item.recordSource?.start != null && item.recordSource?.end != null));
  assert.equal(recordFields.find(item => item.definitionId === 'priorSpouses.middle-name')?.value, 'Initial');
  assert.equal(recordFields.find(item => item.definitionId === 'priorSpouses.name-at-birth')?.value, 'Birth Name');
  assert.equal(recordFields.find(item => item.definitionId === 'priorSpouses.prior-spouse-died-since-marriage-ended')?.value, 'Unknown');
  assert(recordFields.some(item => item.valueStatus === 'missing' && item.recordId === second.recordId));

  const profile = fromIntakeChecker(state);
  const before = profile.fields.find(item => item.definitionId === 'priorSpouses.first-name' && item.recordId === 'priorSpouses-1');
  assert.equal(before.sources[0].rawValue, 'Former One');
  assert(before.recordSource?.start != null);
  assert.equal(correctIntakeField(state, before.correctionTarget, 'Corrected Name'), true);
  const corrected = fromIntakeChecker(state).fields.find(item => item.id === before.id);
  assert.equal(corrected.sources[0].rawValue, 'Former One');
  assert.equal(corrected.value, 'Corrected Name');
  assert.equal(corrected.employeeReview.edits.at(-1).value, 'Corrected Name');
  assert.equal(corrected.recordSource.start, before.recordSource.start);
});

test('all validation and review decisions remain intact and dismissals never change the underlying value', () => {
  const state = session('PERSONAL INFORMATION\nPhone Number: 123\nEMPLOYMENT INFORMATION\nCurrently working: Yes\nMARRIAGE INFORMATION\nMarital Status: Separated\nFINANCIAL SUPPORT\nVeteran Benefits - Receive Veteran Benefits: Yes');
  state.report.issues.forEach(state.validationState.review);
  state.review.items.forEach(state.reviewState.review);
  const data = createClientData(state);
  assert.equal(data.validationIssues.length, state.report.issues.length);
  assert(data.validationIssues.every(item => item.dismissed));
  assert.equal(data.reviewItems.length, 3); assert(data.reviewItems.every(item => item.reviewed));
  const phone = field(data, 'personal.phone-number');
  assert.equal(phone.valueStatus, 'invalid'); assert.equal(phone.value, null);
  assert(phone.validation.hasErrors); assert(phone.validation.dismissedIssueIds.length);
  assert.equal(phone.validation.unresolvedIssueIds.length, 0);
  assert(field(data, 'employment.currently-working').review.reviewedIds.length);
  assert(field(data, 'financial-support.veteran-benefits-receive-veteran-benefits').review.reviewedIds.length);
});

test('corrections preserve stable field IDs, original source and edit ledger; recheck resets corrections and review', () => {
  const text = 'PERSONAL INFORMATION\nPhone Number: 123\nEMPLOYMENT INFORMATION\nCurrently working: Yes';
  const state = session(text), before = createClientData(state);
  state.report.issues.forEach(state.validationState.review);
  const target = fromIntakeChecker(state).fields.find(item => item.definitionId === 'personal.phone-number').correctionTarget;
  assert(correctIntakeField(state, target, '2025550142'));
  const after = createClientData(state), phone = field(after, 'personal.phone-number');
  assert.equal(phone.id, field(before, 'personal.phone-number').id);
  assert.equal(phone.value, '202-555-0142'); assert.equal(phone.origin, 'employee_entered');
  assert.equal(phone.occurrences[0].originalValue, '123');
  assert.equal(phone.occurrences[0].corrections[0].value, '2025550142');
  assert.deepEqual(phone.occurrences[0].source, field(before, 'personal.phone-number').occurrences[0].source);
  assert.equal(after.source.text, text); assert.equal(after.revision, 1);
  after.fields[0].label = 'Changed snapshot'; after.validationIssues.length = 0;
  assert.notDeepEqual(after, createClientData(state));
  const rechecked = createClientData(session(text));
  assert.equal(rechecked.revision, 0); assert.equal(field(rechecked, 'personal.phone-number').origin, 'parsed');
  assert(rechecked.validationIssues.every(issue => !issue.dismissed));
});

test('school fallback, conditional requirements and distinct date meanings reuse Checker outcomes', () => {
  const state = session('EDUCATION INFORMATION\nSchool City: Synthetic\nSchool State: Synthetic\nSchool name where highest grade completed: Synthetic\nDISABILITY INFORMATION\nOnset date of disability: 01/2000\nEMPLOYMENT INFORMATION\nHave you ever worked: No\nWhen did you last work: 02/2000\nCurrently working: No\nDate work stopped:\n03/2000\nMEDICAL PROVIDERS\nClinic 1\nFirst Visit Date: 2000-02-02\nLast Visit Date: 2000-01-01');
  const data = createClientData(state);
  assert.equal(field(data, 'school.school-city').value, 'Synthetic');
  assert.equal(field(data, 'disability.onset-date-of-disability').value, '2000-01');
  assert.equal(field(data, 'employment.when-did-you-last-work').value, '2000-02');
  assert.equal(field(data, 'employment.when-did-you-last-work').precision, 'month');
  const stopped = data.fields.find(item => item.label === 'Date work stopped');
  assert.equal(stopped.value, '03/2000'); assert.equal(stopped.supported, false);
  assert.equal(field(data, 'providers.first-visit-date').validation.hasErrors, true);
  assert.equal(field(data, 'providers.last-visit-date').validation.hasErrors, true);
  assert.deepEqual(data.validationIssues.map(({ id, dismissed, sources, fieldIds, ...issue }) => issue), state.report.issues);
});

test('scope IDs survive unrelated section insertion; source-free employee fields remain explicitly unsourced', () => {
  const text = 'PERSONAL INFORMATION\nFirst Name: Synthetic';
  assert.equal(field(createClientData(session(text)), 'personal.first-name').id,
    field(createClientData(session('VITALS\nHeight (feet): 5\n' + text)), 'personal.first-name').id);
  const state = session(text);
  assert(correctIntakeField(state, { nodePath: '/0', section: 'PERSONAL INFORMATION', label: 'Last Name' }, 'Example'));
  const edited = field(createClientData(state), 'personal.last-name');
  assert.equal(edited.occurrences[0].source, null); assert.equal(edited.occurrences[0].originalValue, null);
  assert.equal(edited.origin, 'employee_entered');
});

test('unrecognized-only input can be inspected without running validation or inventing results', () => {
  const state = createIntakeSession(parseIntake('Unrecognized synthetic input'), { validate: false });
  const data = createClientData(state);
  assert.equal(data.validationPerformed, false); assert.equal(data.validationIssues.length, 0);
  assert.equal(data.unparsed.length, 1); assert.equal(data.source.text, 'Unrecognized synthetic input');
  assert.equal(data.coverage.parsedOccurrences, 0);
});

test('absent-section correction keeps the same field ID and never invents a source range', () => {
  const state = session('PERSONAL INFORMATION\nFirst Name: Synthetic');
  const before = field(createClientData(state), 'birth.city-of-birth');
  assert(correctIntakeField(state, { section: 'BIRTH INFORMATION', label: 'City of Birth', nodePath: null }, 'Synthetic City'));
  const data = createClientData(state), after = field(data, 'birth.city-of-birth');
  assert.equal(after.id, before.id); assert.equal(after.parsed, false);
  assert.equal(after.occurrences[0].source, null); assert.equal(after.origin, 'employee_entered');
  assert.equal(data.coverage.currentOccurrences, data.coverage.preservedOccurrences);
  assert.equal(data.coverage.parsedOccurrences, 1);
});

test('original field occurrence order is retained even when duplicate labels are grouped', () => {
  const data = createClientData(session('PERSONAL INFORMATION\nFirst Name: SYNTHETIC\nLast Name: Example\nFirst Name: Synthetic'));
  const scope = data.scopes.find(scope => scope.title === 'PERSONAL INFORMATION');
  const occurrences = new Map(data.fields.flatMap(field => field.occurrences.map(item => [item.id, item])));
  assert.deepEqual(scope.occurrenceIds.map(id => occurrences.get(id).currentValue), ['SYNTHETIC', 'Example', 'Synthetic']);
});

test('all review families retain exact dependencies without treating acknowledgement as an answer', () => {
  const text = 'DISABILITY INFORMATION\nOnset date of disability: 1999-01-01\nWORK HISTORY\nJob 1\nStart Date: 2000-01-01\nEnd Date: 2000-02-01\nOTHER NAMES\nUsed other names in medical records: Yes\nMEDICAL PROBLEMS\n' + Array.from({length:11},(_,i)=>`Problem ${i+1}: Synthetic condition ${i+1}`).join('\n');
  const state = session(text), data = createClientData(state);
  const failed = data.reviewItems.find(item => item.message.startsWith('Failed Work Attempt'));
  assert(failed); assert.equal(failed.fieldIds.length, 3);
  assert(failed.fieldIds.some(id => id.startsWith('disability.onset-date-of-disability@')));
  const medical = data.reviewItems.find(item => item.message === 'More Than 10 Conditions');
  assert.equal(medical.fieldIds.length, 11);
  assert.equal(data.reviewItems.find(item => item.message === 'Other Names').fieldIds.length, 1);
  assert.equal(data.derived.dependencies.medicalProblemCount.length, 11);
  state.review.items.forEach(state.reviewState.review);
  assert(createClientData(state).reviewItems.every(item => item.reviewed));
});

test('numbered prior spouse names and dates are supported without relabeling them as current spouse answers', () => {
  const data = createClientData(session('MARRIAGE INFORMATION\nPrevious Spouse 1\nFirst Name: Synthetic\nMarriage Date: 2000-01-01'));
  assert(!data.fields.some(item => item.definitionId === 'spouse.first-name'));
  assert(data.fields.some(item => item.definitionId === 'priorSpouses.first-name' && item.supported && item.value === 'Synthetic'));
  assert(data.fields.some(item => item.definitionId === 'priorSpouses.marriage-date' && item.supported && item.value === '2000-01-01'));
});

test('audit inventory matches all Checker-owned definitions and canonical modules have no automatic data transport/storage', () => {
  const text = readFileSync(new URL('../intake-checker/CLIENT-DATA.md', import.meta.url), 'utf8');
  for (const definition of fieldDefinitions) assert(text.includes(`| ${definition.id} | ${definition.section} | ${definition.label} | ${definition.dataType} |`), definition.id);
  for (const path of ['client-data.js', 'field-catalog.js', 'client-data-view.js']) {
    const source = readFileSync(new URL('../intake-checker/' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon|console\.|history\.|postMessage\(/);
  }
});
