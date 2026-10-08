import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake } from '../intake-checker/parser.js';
import { createIntakeSession, correctIntakeField } from '../intake-checker/session.js';
import { createClientData } from '../intake-checker/client-data.js';
import { canonicalPracticeProfile } from '../ssa-intake-assistant/src/model/canonical-practice-profile.js';
import { mappings, planPractice } from '../ssa-intake-assistant/extension-dev/mapping.js';
import { projectReady } from '../ssa-intake-assistant/extension-dev/bridge-contract.js';
import { completeSyntheticIntake } from '../ssa-intake-assistant/tests/complete-intake.mjs';
import { fieldDefinitions } from '../intake-checker/field-catalog.js';

const canonical = () => createClientData(createIntakeSession(parseIntake(completeSyntheticIntake())));

test('canonical Checker data projects only exact ready practice questions', () => {
  const data = canonical(), profile = canonicalPracticeProfile(data);
  const ids = mappings.filter(mapping => mapping.definitionId && mapping.recordCategory !== 'priorSpouses').map(mapping =>
    mapping.recordCategory === 'spouse' ? `${mapping.definitionId}@current-spouse`
      : mapping.recordCategory === 'jobs' ? `${mapping.definitionId}@job-1` : mapping.definitionId)
    .concat(['children.first-name@child-1', 'children.last-name@child-1']);
  assert.deepEqual(profile.fields.map(field => field.id), ids);
  assert.equal(profile.schema, 'packard.intake-client-profile');
  assert.equal(profile.schemaVersion, '3.5.0');
  assert.deepEqual(profile.jobRecords, ['job-1']);
  assert.deepEqual(profile.conditionalQuestionFields, [
    'employment.worked-outside-united-states', 'employment.eligible-for-foreign-ssi', 'employment.foreign-ssi-country',
    'previous-applications.previous-applications-previously-applied-for-medicare-ss-ssi',
    'previous-applications.previous-applications-medicare',
    'previous-applications.previous-applications-social-security',
    'previous-applications.previous-applications-ssi',
    'workers-compensation.illnesses-injuries-work-related',
    'wages-earnings.expect-money-from-employer-in-future',
  ]);
  assert.deepEqual(profile.conditionalQuestionMissingFields, []);
  assert.equal(profile.fields.find(field => field.definitionId === 'employment.worked-outside-united-states')?.value, true);
  assert.equal(profile.fields.find(field => field.definitionId === 'employment.eligible-for-foreign-ssi')?.value, false);
  assert.equal(profile.fields.find(field => field.definitionId === 'employment.foreign-ssi-country')?.value, 'Example Country');
  assert.equal(profile.fields.find(field => field.definitionId === 'previous-applications.previous-applications-previously-applied-for-medicare-ss-ssi')?.value, true);
  assert.equal(profile.fields.find(field => field.definitionId === 'workers-compensation.illnesses-injuries-work-related')?.value, true);
  assert.equal(profile.fields.find(field => field.definitionId === 'wages-earnings.expect-money-from-employer-in-future')?.value, false);
  assert.equal(planPractice(profile).filter(item => item.status === 'ready').length, 70);
  assert.deepEqual(projectReady(profile), profile);
  assert(!JSON.stringify(profile).includes('Synthetic condition'));
  for (const field of profile.fields) assert.deepEqual(Object.keys(field).sort(),
    ['id', 'definitionId', 'recordId', 'dataType', 'value', 'precision', 'readiness', 'blockingReasons'].sort());
});

test('foreign work and benefit answers map independently, and missing or invalid values stay out of transfer', () => {
  const yesNoData = canonical();
  const outside = yesNoData.fields.find(field => field.definitionId === 'employment.worked-outside-united-states');
  const eligible = yesNoData.fields.find(field => field.definitionId === 'employment.eligible-for-foreign-ssi');
  assert.equal(outside.value, true);
  assert.equal(eligible.value, false);
  outside.value = false;
  eligible.value = true;
  let profile = canonicalPracticeProfile(yesNoData);
  assert.equal(profile.fields.find(field => field.definitionId === outside.definitionId)?.value, false);
  assert.equal(profile.fields.find(field => field.definitionId === eligible.definitionId)?.value, true);

  const noCountryInput = completeSyntheticIntake().replace('**Foreign SSI country:** Example Country', '**Foreign SSI country:** Not provided');
  const noCountryData = createClientData(createIntakeSession(parseIntake(noCountryInput)));
  profile = canonicalPracticeProfile(noCountryData);
  assert(profile.conditionalQuestionFields.includes('employment.foreign-ssi-country'));
  assert(profile.conditionalQuestionMissingFields.includes('employment.foreign-ssi-country'));
  assert(!profile.fields.some(field => field.definitionId === 'employment.foreign-ssi-country'));
  assert(!projectReady(profile).fields.some(field => field.definitionId === 'employment.foreign-ssi-country'));

  for (const label of ['Worked outside United States', 'Eligible for foreign SSI']) {
    const invalidInput = completeSyntheticIntake().replace(`**${label}:** ${label === 'Worked outside United States' ? 'Yes' : 'No'}`,
      `**${label}:** Maybe`);
    const invalidData = createClientData(createIntakeSession(parseIntake(invalidInput)));
    invalidData.validationIssues.forEach(issue => { issue.dismissed = true; });
    invalidData.reviewItems.forEach(item => { item.reviewed = true; });
    const def = fieldDefinitions.find(item => item.label === label && item.section === 'EMPLOYMENT INFORMATION');
    assert.equal(invalidData.fields.find(field => field.definitionId === def.id).valueStatus, 'ambiguous');
    assert(!canonicalPracticeProfile(invalidData).fields.some(field => field.definitionId === def.id));
  }
  const conflictedInput = completeSyntheticIntake().replace('**Worked outside United States:** Yes',
    '**Worked outside United States:** Yes\n**Worked outside United States:** No');
  const conflicted = createClientData(createIntakeSession(parseIntake(conflictedInput)));
  assert.equal(conflicted.fields.find(field => field.definitionId === 'employment.worked-outside-united-states').valueStatus, 'conflict');
  assert(!canonicalPracticeProfile(conflicted).fields.some(field => field.definitionId === 'employment.worked-outside-united-states'));

  const unresolved = canonical();
  unresolved.validationIssues.forEach(issue => { issue.dismissed = true; });
  unresolved.reviewItems.forEach(item => { item.reviewed = true; });
  unresolved.fields.find(field => field.definitionId === 'employment.eligible-for-foreign-ssi')
    .validation.unresolvedIssueIds.push('synthetic-unresolved');
  assert(!canonicalPracticeProfile(unresolved).fields.some(field =>
    field.definitionId === 'employment.eligible-for-foreign-ssi'));
});

test('employment questions are absent when the Checker source has none', () => {
  const omitted = new Set([
    'Worked outside United States', 'Eligible for foreign SSI', 'Foreign SSI country',
    'Previous Applications - Previously applied for Medicare/SS/SSI', 'Previous Applications - Medicare',
    'Previous Applications - Social Security', 'Previous Applications - SSI',
    'Illnesses/injuries work related', 'Expect money from employer in future',
  ]);
  const text = completeSyntheticIntake().split('\n')
    .filter(line => ![...omitted].some(label => line.startsWith(`**${label}:**`))).join('\n');
  const profile = canonicalPracticeProfile(createClientData(createIntakeSession(parseIntake(text))));
  assert.deepEqual(profile.conditionalQuestionFields, []);
  assert.deepEqual(profile.conditionalQuestionMissingFields, []);
  assert(!profile.fields.some(field => field.definitionId.startsWith('employment.worked-')
    || field.definitionId.startsWith('employment.eligible-for-foreign-ssi')
    || field.definitionId === 'employment.foreign-ssi-country'));
});

test('previous application and work-condition answers are independent and benefit types stay unmapped', () => {
  const input = completeSyntheticIntake()
    .replace('**Previous Applications - Previously applied for Medicare/SS/SSI:** Yes',
      '**Previous Applications - Previously applied for Medicare/SS/SSI:** No')
    .replace('**Previous Applications - Medicare:** Yes', '**Previous Applications - Medicare:** Yes')
    .replace('**Previous Applications - Social Security:** No', '**Previous Applications - Social Security:** Yes')
    .replace('**Previous Applications - SSI:** Yes', '**Previous Applications - SSI:** Yes')
    .replace('**Illnesses/injuries work related:** Yes', '**Illnesses/injuries work related:** No')
    .replace('**Expect money from employer in future:** No', '**Expect money from employer in future:** Yes');
  const profile = canonicalPracticeProfile(createClientData(createIntakeSession(parseIntake(input))));
  assert.equal(profile.fields.find(field => field.definitionId === 'previous-applications.previous-applications-previously-applied-for-medicare-ss-ssi')?.value, false);
  assert.equal(profile.fields.find(field => field.definitionId === 'workers-compensation.illnesses-injuries-work-related')?.value, false);
  assert.equal(profile.fields.find(field => field.definitionId === 'wages-earnings.expect-money-from-employer-in-future')?.value, true);
  assert.equal(planPractice(profile).find(item => item.target === 'previous-application')?.value, false);
  assert.equal(planPractice(profile).find(item => item.target === 'conditions-related-to-work')?.value, false);
  assert.equal(planPractice(profile).find(item => item.target === 'expect-to-receive-more-money')?.value, true);

  const withoutCombined = input.replace('**Previous Applications - Previously applied for Medicare/SS/SSI:** No\n', '');
  const noCombinedData = createClientData(createIntakeSession(parseIntake(withoutCombined)));
  const noCombinedProfile = canonicalPracticeProfile(noCombinedData);
  assert(!noCombinedProfile.fields.some(field => field.definitionId ===
    'previous-applications.previous-applications-previously-applied-for-medicare-ss-ssi'));
  assert.equal(planPractice(noCombinedProfile).find(item => item.target === 'previous-application')?.status, 'pause');
  assert(noCombinedData.fields.some(field => field.definitionId === 'previous-applications.previous-applications-medicare'
    && field.value === true));

  for (const definitionId of [
    'previous-applications.previous-applications-medicare',
    'previous-applications.previous-applications-social-security',
    'previous-applications.previous-applications-ssi',
  ]) assert(!mappings.some(mapping => mapping.definitionId === definitionId));
  assert(!mappings.some(mapping => /Which type of benefits|Money from employer after onset date|Received money from employer after unable to work|Filed on another person's SSN|Different name/i.test(mapping.label)));
});

test('ambiguous new booleans remain blocked and corrections use their exact source field', () => {
  const ambiguousInput = completeSyntheticIntake().replace(
    '**Expect money from employer in future:** No', '**Expect money from employer in future:** Maybe');
  const ambiguousData = createClientData(createIntakeSession(parseIntake(ambiguousInput)));
  const ambiguous = ambiguousData.fields.find(field => field.definitionId === 'wages-earnings.expect-money-from-employer-in-future');
  assert.equal(ambiguous.valueStatus, 'ambiguous');
  assert(!canonicalPracticeProfile(ambiguousData).fields.some(field => field.definitionId === ambiguous.definitionId));

  const session = createIntakeSession(parseIntake(completeSyntheticIntake()));
  const data = createClientData(session);
  const source = data.fields.find(field => field.definitionId === 'workers-compensation.illnesses-injuries-work-related');
  const scope = data.scopes.find(item => item.id === source.scopeId);
  assert(correctIntakeField(session, {
    nodePath: scope.nodePath, section: "WORKER'S COMPENSATION", label: source.label,
    range: source.occurrences[0].source,
  }, 'No'));
  const corrected = createClientData(session);
  assert.equal(corrected.fields.find(field => field.definitionId === source.definitionId).value, false);
  assert.equal(canonicalPracticeProfile(corrected).fields.find(field => field.definitionId === source.definitionId)?.value, false);
});

test('conflicting and unresolved new mapped answers never enter the practice profile', () => {
  const cases = [
    ['Previous Applications - Previously applied for Medicare/SS/SSI', 'previous-applications.previous-applications-previously-applied-for-medicare-ss-ssi', 'Yes', 'No'],
    ['Illnesses/injuries work related', 'workers-compensation.illnesses-injuries-work-related', 'Yes', 'No'],
    ['Expect money from employer in future', 'wages-earnings.expect-money-from-employer-in-future', 'No', 'Yes'],
  ];
  for (const [label, definitionId, original, conflicting] of cases) {
    const conflictingInput = completeSyntheticIntake().replace(
      `**${label}:** ${original}`, `**${label}:** ${original}\n**${label}:** ${conflicting}`);
    const conflictingData = createClientData(createIntakeSession(parseIntake(conflictingInput)));
    assert.equal(conflictingData.fields.find(field => field.definitionId === definitionId).valueStatus, 'conflict');
    assert(!canonicalPracticeProfile(conflictingData).fields.some(field => field.definitionId === definitionId));

    const unresolved = canonical();
    unresolved.fields.find(field => field.definitionId === definitionId).validation.unresolvedIssueIds.push('synthetic-unresolved');
    assert(!canonicalPracticeProfile(unresolved).fields.some(field => field.definitionId === definitionId));
  }
});

test('foreign benefit correction transfers only its corrected exact value', () => {
  const session = createIntakeSession(parseIntake(completeSyntheticIntake()));
  const original = createClientData(session).fields.find(field => field.definitionId === 'employment.foreign-ssi-country');
  const scope = createClientData(session).scopes.find(item => item.id === original.scopeId);
  assert(correctIntakeField(session, {
    nodePath: scope.nodePath, section: 'EMPLOYMENT INFORMATION', label: 'Foreign SSI country',
    range: original.occurrences[0].source,
  }, 'Synthetic Corrected Country'));
  const correctedData = createClientData(session);
  const corrected = correctedData.fields.find(field => field.definitionId === 'employment.foreign-ssi-country');
  assert.equal(corrected.occurrences[0].originalValue, 'Example Country');
  assert.equal(corrected.occurrences[0].currentValue, 'Synthetic Corrected Country');
  assert.equal(corrected.origin, 'employee_entered');
  assert.equal(canonicalPracticeProfile(correctedData).fields.find(field =>
    field.definitionId === 'employment.foreign-ssi-country')?.value, 'Synthetic Corrected Country');
});

test('unresolved Checker notices stop transfer; dismissed errors do not turn invalid values ready', () => {
  const data = canonical();
  data.validationIssues.push({ id: 'synthetic-issue', dismissed: false });
  assert.equal(canonicalPracticeProfile(data).fields.length, 0);
  data.validationIssues[0].dismissed = true;
  const field = data.fields.find(item => item.definitionId === 'personal.first-name');
  field.validation.hasErrors = true;
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === field.definitionId));
  field.validation.hasErrors = false;
  field.validation.unresolvedIssueIds.push('synthetic-issue');
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === field.definitionId));
});

test('missing, ambiguous, conflicts, invalid values and malformed validation never transfer', () => {
  for (const status of ['missing', 'ambiguous', 'conflict', 'invalid']) {
    const data = canonical(), field = data.fields.find(item => item.definitionId === 'personal.first-name');
    field.valueStatus = status;
    assert(!canonicalPracticeProfile(data).fields.some(item => item.id === field.definitionId), status);
  }
  const data = canonical(), field = data.fields.find(item => item.definitionId === 'personal.first-name');
  delete field.validation;
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === field.definitionId));
  assert.equal(canonicalPracticeProfile({ ...data, schemaVersion: 'unknown' }).fields.length, 0);
});

test('date precision, duplicate singleton and employee correction are respected in memory', () => {
  const data = canonical();
  const lastWorked = data.fields.find(item => item.definitionId === 'employment.when-did-you-last-work');
  lastWorked.precision = 'month';
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === lastWorked.definitionId));
  const onset = data.fields.find(item => item.definitionId === 'disability.onset-date-of-disability');
  onset.precision = 'month';
  assert(canonicalPracticeProfile(data).fields.some(item => item.id === onset.definitionId));
  data.fields.push({ ...data.fields.find(item => item.definitionId === 'personal.first-name') });
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === 'personal.first-name'));

  const session = createIntakeSession(parseIntake(completeSyntheticIntake()));
  assert(correctIntakeField(session, { nodePath: '/0', section: 'PERSONAL INFORMATION', label: 'First Name' }, 'Example'));
  const edited = createClientData(session);
  const corrected = canonicalPracticeProfile(edited).fields.find(item => item.id === 'personal.first-name');
  assert.equal(corrected.value, 'Example');
  assert.equal(edited.fields.find(item => item.definitionId === 'personal.first-name').origin, 'employee_entered');
});

test('employment appears only for actual jobs and each exact ready record maps independently', () => {
  const noJobsInput = completeSyntheticIntake().replace(
    /## WORK HISTORY\n[\s\S]*?(?=\n## |$)/, '## WORK HISTORY\n');
  const noJobsData = createClientData(createIntakeSession(parseIntake(noJobsInput)));
  const noJobsProfile = canonicalPracticeProfile(noJobsData);
  assert.deepEqual(noJobsProfile.jobRecords, []);
  assert(!noJobsProfile.fields.some(field => field.definitionId.startsWith('jobs.')));
  assert(!planPractice(noJobsProfile).some(item => item.recordCategory === 'jobs'));

  const multipleJobsInput = completeSyntheticIntake().replace('**Job Title:** Synthetic', '**Job Title:** Fictional Recent Title').replace('\n## CHILDREN INFORMATION', `
Previous Job
Job Title: Synthetic
Employer: Fictional Previous Company
Business Type: Example
Start Date: 2001-02-03
End Date: 2009-12-31
Hours per Day: 8
Days per Week: 5
Rate of Pay: $10.00
Pay Frequency: Monthly
Address: 456 Fictional Work Road
City: Other Sample City
State: FX
Zipcode: 11111

## CHILDREN INFORMATION`);
  const withPreviousSpouse = multipleJobsInput.replace('\n## SCHOOL INFORMATION', `
Previous Spouse 1
First Name: Fictional Former

## SCHOOL INFORMATION`);
  const data = createClientData(createIntakeSession(parseIntake(withPreviousSpouse)));
  data.validationIssues.forEach(issue => { issue.dismissed = true; });
  data.reviewItems.forEach(item => { item.reviewed = true; });
  const profile = canonicalPracticeProfile(data);
  assert.deepEqual(profile.jobRecords, ['job-1', 'job-2']);
  assert.equal(profile.fields.find(field => field.id === 'jobs.job-title@job-1')?.value, 'Fictional Recent Title');
  assert.equal(profile.fields.find(field => field.id === 'jobs.job-title@job-2')?.value, 'Synthetic');
  assert.equal(profile.fields.find(field => field.id === 'jobs.employer@job-1')?.value, 'Synthetic');
  assert.equal(profile.fields.find(field => field.id === 'jobs.employer@job-2')?.value, 'Fictional Previous Company');
  assert.equal(profile.fields.find(field => field.id === 'jobs.start-date@job-2')?.value, '2001-02-03');
  assert.equal(profile.fields.find(field => field.id === 'jobs.end-date@job-2')?.value, '2009-12-31');
  assert.equal(planPractice(profile).find(item => item.target === 'employment-start-date' && item.recordId === 'job-2').value, '2001-02-03');
  assert.deepEqual(projectReady(profile).jobRecords, profile.jobRecords);
  assert.equal(projectReady(profile).fields.filter(field => field.recordId === 'job-1' || field.recordId === 'job-2').length, 26);
  for (const [definitionId, value] of [
    ['jobs.job-title', 'Synthetic'], ['jobs.business-type', 'Example'], ['jobs.hours-per-day', '8'],
    ['jobs.days-per-week', '5'], ['jobs.rate-of-pay', '$10.00'], ['jobs.pay-frequency', 'Monthly'],
  ]) {
    assert.equal(profile.fields.find(field => field.definitionId === definitionId && field.recordId === 'job-2')?.value, value);
    assert.equal(planPractice(profile).find(item => item.definitionId === definitionId && item.recordId === 'job-2')?.value, value);
  }
  assert(profile.fields.some(field => field.id === 'spouse.first-name@current-spouse'));
  assert(profile.fields.some(field => field.id === 'children.first-name@child-1'));
  assert(profile.fields.some(field => field.id.startsWith('priorSpouses.first-name@prior-spouse-1')));
  for (const target of ['employment-2025', 'employment-2026', 'employment-2027', 'employment-country',
    'employment-street-line-2', 'employment-not-ended']) {
    assert.equal(mappings.find(mapping => mapping.target === target).definitionId, null);
    assert.equal(planPractice(profile).find(item => item.target === target && item.recordId === 'job-1').status, 'pause');
    assert.equal(planPractice(profile).find(item => item.target === target && item.recordId === 'job-2').status, 'pause');
  }
});

test('employment fields reject missing, invalid, ambiguous, conflicting, unresolved and incomplete date answers', () => {
  for (const status of ['missing', 'invalid', 'ambiguous', 'conflict']) {
    const data = canonical();
    const field = data.fields.find(item => item.definitionId === 'jobs.employer');
    field.valueStatus = status; field.value = null;
    assert(!canonicalPracticeProfile(data).fields.some(item => item.id === 'jobs.employer@job-1'), status);
  }
  const conflictingInput = completeSyntheticIntake().replace(
    '**Employer:** Synthetic', '**Employer:** Fictional One\n**Employer:** Fictional Two');
  const conflictingData = createClientData(createIntakeSession(parseIntake(conflictingInput)));
  const conflictingField = conflictingData.fields.find(item => item.definitionId === 'jobs.employer');
  assert.equal(conflictingField.valueStatus, 'conflict');
  assert(!canonicalPracticeProfile(conflictingData).fields.some(item => item.id === 'jobs.employer@job-1'));
  const data = canonical(), start = data.fields.find(item => item.definitionId === 'jobs.start-date');
  start.precision = 'month';
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === 'jobs.start-date@job-1'));
  start.precision = 'day'; start.validation.unresolvedIssueIds.push('unresolved-employment');
  assert(!canonicalPracticeProfile(data).fields.some(item => item.id === 'jobs.start-date@job-1'));

  const invalidInput = completeSyntheticIntake().replace('**Start Date:** 2000-01-01', '**Start Date:** 02/30/2000');
  const invalidData = createClientData(createIntakeSession(parseIntake(invalidInput)));
  invalidData.validationIssues.forEach(issue => { issue.dismissed = true; });
  invalidData.reviewItems.forEach(item => { item.reviewed = true; });
  const invalidField = invalidData.fields.find(item => item.definitionId === 'jobs.start-date');
  assert.equal(invalidField.valueStatus, 'invalid');
  assert(!canonicalPracticeProfile(invalidData).fields.some(item => item.id === 'jobs.start-date@job-1'));
});

test('all added job fields reject non-ready Checker values and preserve valid corrections', () => {
  const added = ['jobs.job-title', 'jobs.business-type', 'jobs.hours-per-day', 'jobs.days-per-week',
    'jobs.rate-of-pay', 'jobs.pay-frequency'];
  for (const definitionId of added) {
    for (const valueStatus of ['missing', 'invalid', 'ambiguous', 'conflict']) {
      const data = canonical();
      const field = data.fields.find(item => item.definitionId === definitionId);
      field.valueStatus = valueStatus;
      field.value = null;
      assert(!canonicalPracticeProfile(data).fields.some(item =>
        item.definitionId === definitionId && item.recordId === 'job-1'), `${definitionId}: ${valueStatus}`);
    }
  }

  const session = createIntakeSession(parseIntake(completeSyntheticIntake()));
  const data = createClientData(session);
  const title = data.fields.find(item => item.definitionId === 'jobs.job-title');
  const scope = data.scopes.find(item => item.id === title.scopeId);
  assert(correctIntakeField(session, {
    nodePath: scope.nodePath, section: 'WORK HISTORY', label: 'Job Title', range: title.occurrences[0].source,
  }, 'Corrected Synthetic Title'));
  const correctedData = createClientData(session);
  const correctedField = correctedData.fields.find(item => item.definitionId === 'jobs.job-title');
  assert.equal(correctedField.occurrences[0].originalValue, 'Synthetic');
  assert.equal(correctedField.occurrences[0].currentValue, 'Corrected Synthetic Title');
  assert.equal(correctedField.origin, 'employee_entered');
  assert.equal(canonicalPracticeProfile(correctedData).fields.find(item =>
    item.definitionId === 'jobs.job-title' && item.recordId === 'job-1')?.value, 'Corrected Synthetic Title');
});

test('valid employee corrections to employment fields stay in memory and enter only the exact job handoff', () => {
  const session = createIntakeSession(parseIntake(completeSyntheticIntake()));
  const data = createClientData(session);
  const start = data.fields.find(item => item.definitionId === 'jobs.start-date');
  assert(correctIntakeField(session, {
    nodePath: start.scopeId ? data.scopes.find(scope => scope.id === start.scopeId).nodePath : null,
    section: 'WORK HISTORY', label: 'Start Date', range: start.occurrences[0].source,
  }, '2012-04-05'));
  const correctedData = createClientData(session);
  const correctedField = correctedData.fields.find(item => item.definitionId === 'jobs.start-date');
  assert.equal(correctedField.occurrences[0].originalValue, '2000-01-01');
  assert.equal(correctedField.occurrences[0].currentValue, '2012-04-05');
  assert.equal(correctedField.origin, 'employee_entered');
  const profile = canonicalPracticeProfile(correctedData);
  assert.equal(profile.fields.find(item => item.id === 'jobs.start-date@job-1')?.value, '2012-04-05');
  assert.equal(projectReady(profile).fields.find(item => item.id === 'jobs.start-date@job-1')?.value, '2012-04-05');
});

test('birthplace and mailing address retain separate exact Checker values without inference', () => {
  const data = canonical(), profile = canonicalPracticeProfile(data);
  const additions = ['birth.city-of-birth','birth.state-of-birth','birth.country-of-birth',
    'address.mailing-address-street-address','address.mailing-address-city',
    'address.mailing-address-state','address.mailing-address-zipcode'];
  for (const id of additions) {
    const original = data.fields.find(field => field.definitionId === id);
    const projected = profile.fields.find(field => field.id === id);
    assert(projected, id);
    assert.equal(projected.value, original.value);
  }
  const birthCity = data.fields.find(field => field.definitionId === 'birth.city-of-birth');
  birthCity.valueStatus = 'missing'; birthCity.value = null;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === birthCity.definitionId));
  assert(canonicalPracticeProfile(data).fields.some(field => field.id === 'address.mailing-address-city'));
  const zip = data.fields.find(field => field.definitionId === 'address.mailing-address-zipcode');
  zip.validation.hasErrors = true;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === zip.definitionId));
  const mailingState = data.fields.find(field => field.definitionId === 'address.mailing-address-state');
  data.fields.push({ ...mailingState });
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === mailingState.definitionId));
});

test('physical address fields use only physical sources and never borrow mailing values', () => {
  const input = completeSyntheticIntake()
    .replace('**Physical Address - Street Address:** Synthetic', '**Physical Address - Street Address:** 456 Fictional Avenue')
    .replace('**Physical Address - City:** Synthetic', '**Physical Address - City:** Another City');
  const data = createClientData(createIntakeSession(parseIntake(input)));
  const physicalIds = ['address.physical-address-street-address', 'address.physical-address-street-address-2',
    'address.physical-address-city', 'address.physical-address-state', 'address.physical-address-zipcode'];
  const profile = canonicalPracticeProfile(data);
  for (const id of physicalIds) {
    const source = data.fields.find(field => field.definitionId === id);
    const transferred = profile.fields.find(field => field.id === id);
    assert(transferred, id);
    assert.equal(transferred.value, source.value);
  }
  assert.notEqual(profile.fields.find(field => field.id === 'address.physical-address-city').value,
    profile.fields.find(field => field.id === 'address.mailing-address-city').value);
  const street = data.fields.find(field => field.definitionId === physicalIds[0]);
  street.valueStatus = 'missing'; street.value = null;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === street.definitionId));
  assert(canonicalPracticeProfile(data).fields.some(field => field.id === 'address.mailing-address-street-address'));
  const line2 = data.fields.find(field => field.definitionId === physicalIds[1]);
  line2.valueStatus = 'conflict'; line2.value = null;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === line2.definitionId));
});

test('remaining personal details use exact singleton IDs and blocked values do not transfer', () => {
  const input = completeSyntheticIntake()
    .replace('**Alternate Phone:** 202-555-0142', '**Alternate Phone:** 202-555-0143')
    .replace('**Secondary Phone:** 202-555-0142', '**Secondary Phone:** 202-555-0144');
  const data = createClientData(createIntakeSession(parseIntake(input)));
  const ids = ['personal.gender','personal.social-security-number','personal.suffix',
    'personal.nickname','personal.alternate-phone','personal.secondary-phone'];
  const profile = canonicalPracticeProfile(data);
  for (const id of ids) {
    const source = data.fields.find(field => field.definitionId === id);
    assert.equal(profile.fields.find(field => field.id === id)?.value, source.value, id);
  }
  assert.notEqual(profile.fields.find(field => field.id === 'personal.alternate-phone').value,
    profile.fields.find(field => field.id === 'personal.secondary-phone').value);
  const ssn = data.fields.find(field => field.definitionId === 'personal.social-security-number');
  ssn.valueStatus = 'missing'; ssn.value = null;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === ssn.definitionId));
  assert(data.fields.some(field => field.definitionId === 'spouse.social-security-number'),
    'a spouse SSN exists but cannot replace the client SSN');
  const alternate = data.fields.find(field => field.definitionId === 'personal.alternate-phone');
  alternate.validation.hasErrors = true;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === alternate.definitionId));
  const nickname = data.fields.find(field => field.definitionId === 'personal.nickname');
  data.fields.push({ ...nickname });
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === nickname.definitionId));
});

test('language answers preserve real booleans including No and leave unknown answers blocked', () => {
  const data = canonical(), profile = canonicalPracticeProfile(data);
  const ids = ['language.preferred-language','language.can-speak-and-understand-english',
    'language.can-read-simple-english-messages','language.can-write-simple-english-messages',
    'language.can-read-simple-messages-in-preferred-language',
    'language.can-write-simple-messages-in-preferred-language'];
  for (const id of ids) {
    const source = data.fields.find(field => field.definitionId === id);
    assert.equal(profile.fields.find(field => field.id === id)?.value, source.value, id);
  }
  assert.equal(profile.fields.find(field => field.id === ids[1]).value, false);
  const unreadable = data.fields.find(field => field.definitionId === ids[2]);
  unreadable.valueStatus = 'ambiguous'; unreadable.value = null;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === unreadable.definitionId));
  const writing = data.fields.find(field => field.definitionId === ids[3]);
  writing.validation.hasErrors = true;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === writing.definitionId));
  const speaking = data.fields.find(field => field.definitionId === ids[1]);
  speaking.value = 'No';
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === speaking.definitionId),
    'a string is never coerced into a boolean');
});

test('security answers use only exact Checker singleton values and never infer a relative', () => {
  const data = canonical();
  const ids = ['security-questions.mother-first-name', 'security-questions.mother-maiden-name',
    'security-questions.father-first-name', 'security-questions.father-last-name',
    'security-questions.other-legal-representative'];
  const profile = canonicalPracticeProfile(data);
  for (const id of ids) {
    const source = data.fields.find(field => field.definitionId === id);
    assert.equal(profile.fields.find(field => field.id === id)?.value, source.value, id);
  }
  const mother = data.fields.find(field => field.definitionId === ids[1]);
  mother.valueStatus = 'missing'; mother.value = null;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === ids[1]));
  assert(canonicalPracticeProfile(data).fields.some(field => field.id === ids[3]));
  const father = data.fields.find(field => field.definitionId === ids[3]);
  father.validation.hasErrors = true;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === ids[3]));
  const representative = data.fields.find(field => field.definitionId === ids[4]);
  data.fields.push({ ...representative });
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === ids[4]));
});

test('vitals retain exact units and optional inches never borrow another measure', () => {
  const input = completeSyntheticIntake()
    .replace('**Height (feet):** Synthetic', '**Height (feet):** 5')
    .replace('**Height (inches):** Synthetic', '**Height (inches):** 8')
    .replace('**Weight (pounds):** Synthetic', '**Weight (pounds):** 150');
  const data = createClientData(createIntakeSession(parseIntake(input)));
  const profile = canonicalPracticeProfile(data);
  const expected = [['vitals.height-feet', '5'], ['vitals.height-inches', '8'], ['vitals.weight-pounds', '150']];
  for (const [id, value] of expected) assert.equal(profile.fields.find(field => field.id === id)?.value, value);
  const inches = data.fields.find(field => field.definitionId === 'vitals.height-inches');
  inches.valueStatus = 'missing'; inches.value = null;
  const missing = canonicalPracticeProfile(data);
  assert(!missing.fields.some(field => field.id === inches.definitionId));
  assert.equal(missing.fields.find(field => field.id === 'vitals.height-feet')?.value, '5');
  const pounds = data.fields.find(field => field.definitionId === 'vitals.weight-pounds');
  pounds.validation.hasErrors = true;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === pounds.definitionId));
  data.fields.push({ ...data.fields.find(field => field.definitionId === 'vitals.height-feet') });
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === 'vitals.height-feet'));
});

test('other names transfer exact first and last only, with no invented middle or suffix', () => {
  const input = completeSyntheticIntake()
    .replace('**Other first name:** Synthetic', '**Other first name:** Alternate')
    .replace('**Other last name:** Synthetic', '**Other last name:** Fictional');
  const data = createClientData(createIntakeSession(parseIntake(input)));
  let profile = canonicalPracticeProfile(data);
  assert.equal(profile.fields.find(field => field.id === 'other-names.other-first-name')?.value, 'Alternate');
  assert.equal(profile.fields.find(field => field.id === 'other-names.other-last-name')?.value, 'Fictional');
  assert(!profile.fields.some(field => /other-middle-name|other-suffix/.test(field.id)));
  const first = data.fields.find(field => field.definitionId === 'other-names.other-first-name');
  first.valueStatus = 'ambiguous'; first.value = null;
  profile = canonicalPracticeProfile(data);
  assert(!profile.fields.some(field => field.id === first.definitionId));
  assert(profile.fields.some(field => field.id === 'other-names.other-last-name'));
  const last = data.fields.find(field => field.definitionId === 'other-names.other-last-name');
  last.validation.hasErrors = true;
  assert(!canonicalPracticeProfile(data).fields.some(field => field.id === last.definitionId));
});

test('staff-approved Gender and BlindOrHaveLowVision answers keep their exact values', () => {
  const input = completeSyntheticIntake()
    .replace('**Gender:** Synthetic', '**Gender:** Female')
    .replace('**BlindOrHaveLowVision:** No', '**BlindOrHaveLowVision:** Yes');
  const data = createClientData(createIntakeSession(parseIntake(input)));
  let profile = canonicalPracticeProfile(data);
  assert.equal(profile.fields.find(field => field.id === 'personal.gender')?.value, 'Female');
  assert.equal(profile.fields.find(field => field.id === 'medical-information.blindorhavelowvision')?.value, true);
  const blind = data.fields.find(field => field.definitionId === 'medical-information.blindorhavelowvision');
  blind.valueStatus = 'ambiguous'; blind.value = null;
  profile = canonicalPracticeProfile(data);
  assert(!profile.fields.some(field => field.id === blind.definitionId));
});

test('observed but unsupported medical labels do not block an exact blindness answer', () => {
  const input = `MEDICAL INFORMATION
EmergencyContactFriendFamilyMemberForEmergencyContact: Yes
EmergencyContactFirstName: Fictional
EmergencyContactLastName: Sample
EmergencyContactPhone: 202-555-0142
EmergencyContactRelationship: Example
EmergencyContactLiveWithThisPerson: No
DateBecameDisabled: 01/01/2025
ConditionExpectedToEndInDeath: No
Blind or have low vision: No`;
  const data = createClientData(createIntakeSession(parseIntake(input)));
  assert.equal(data.unparsed.length, 0);
  assert.equal(data.fields.filter(field => field.category === 'unmapped' && field.parsed).length, 8);
  assert.equal(data.fields.find(field => field.definitionId === 'medical-information.blindorhavelowvision')?.value, false);
  data.validationIssues.forEach(issue => { issue.dismissed = true; });
  data.reviewItems.forEach(item => { item.reviewed = true; });
  assert.equal(canonicalPracticeProfile(data).fields.find(field =>
    field.definitionId === 'medical-information.blindorhavelowvision')?.value, false);
});

test('only one exact Current Spouse record transfers; duplicate spouses and partial dates pause', () => {
  const input = completeSyntheticIntake().replace('**Age:** Synthetic', '**Age:** 45')
    .replace('**Social Security Number:** 000-12-3456', '**Social Security Number:** 000-12-3456');
  const data = createClientData(createIntakeSession(parseIntake(input)));
  const profile = canonicalPracticeProfile(data);
  assert.equal(profile.fields.find(field => field.id === 'spouse.age@current-spouse')?.value, '45');
  assert.equal(profile.fields.find(field => field.id === 'spouse.marriage-date@current-spouse')?.precision, 'day');
  const marriageDate = data.fields.find(field => field.definitionId === 'spouse.marriage-date');
  marriageDate.precision = 'month';
  assert(!canonicalPracticeProfile(data).fields.some(field => field.definitionId === 'spouse.marriage-date'));
  const duplicate = input.replace('#### Current Spouse\n', '#### Current Spouse\n');
  const repeated = duplicate.replace(/(## MARRIAGE INFORMATION\n[\s\S]*?)(?=\n## )/,
    '$1\n#### Current Spouse\n**First Name:** Other\n**Last Name:** Partner');
  const duplicateData = createClientData(createIntakeSession(parseIntake(repeated)));
  duplicateData.validationIssues.forEach(issue => { issue.dismissed = true; });
  duplicateData.reviewItems.forEach(item => { item.reviewed = true; });
  assert(!canonicalPracticeProfile(duplicateData).fields.some(field => field.definitionId.startsWith('spouse.')));
});

test('one plain Current Spouse record keeps supplied answers when other spouse answers are missing', () => {
  const input = `MARRIAGE INFORMATION
Marital Status:
Married
Current Spouse
First Name:
Fictional
Last Name:
Not provided
Maiden Name:
Sample
Social Security Number:
Not provided
Marriage Date:
2023-01-01
Birth Country:
Not provided
Birth City:
Not provided
Birth State:
Not provided
Age:
22
City of Marriage:
Sampletown
State of Marriage:
UT
Type of Marriage:
Clergy/Public Official`;
  const data = createClientData(createIntakeSession(parseIntake(input)));
  data.validationIssues.forEach(issue => { issue.dismissed = true; });
  data.reviewItems.forEach(item => { item.reviewed = true; });
  const profile = canonicalPracticeProfile(data);
  assert(profile.fields.some(field => field.definitionId === 'spouse.first-name'));
  assert(profile.fields.some(field => field.definitionId === 'spouse.marriage-date'));
  assert(profile.fields.some(field => field.definitionId === 'spouse.age'));
  assert(!profile.fields.some(field => field.definitionId === 'spouse.last-name'));
  assert(!profile.fields.some(field => field.definitionId === 'spouse.social-security-number'));
  const spouseScope = data.scopes.find(scope => scope.title === 'Current Spouse');
  data.scopes.push({ ...spouseScope, id: 'empty-current-spouse', fieldIds: [], parsed: true });
  assert(canonicalPracticeProfile(data).fields.some(field => field.definitionId === 'spouse.first-name'));
  data.fields.push({ ...data.fields.find(field => field.definitionId === 'spouse.first-name'),
    id: 'spouse.first-name@unrelated', recordId: 'unrelated', scopeId: 'unrelated' });
  assert(canonicalPracticeProfile(data).fields.some(field => field.definitionId === 'spouse.first-name'));
});

test('no previous-spouse records means no prior section metadata or prior-marriage handoff', () => {
  const profile = canonicalPracticeProfile(canonical());
  assert.deepEqual(profile.priorSpouseRecords, []);
  assert(!profile.fields.some(field => field.definitionId.startsWith('priorSpouses.')));
  assert(!planPractice(profile).some(item => item.recordCategory === 'priorSpouses'));
});

test('numbered prior spouses remain independent of Current Spouse and map only exact ready values', () => {
  const input = completeSyntheticIntake().replace('\n## SCHOOL INFORMATION', `
Previous Spouse 1
First Name: Former One
Middle Name: Middle One
Name at Birth: Birth One
Marriage Date: 2001-02-03
Marriage End Date: 2005-06-07
Prior spouse died since marriage ended: Yes
Previous Spouse 2
First Name: Former Two
Name at Birth: Birth Two
Marriage Date: 2010-11-12
Prior spouse died since marriage ended: No
Previous Spouse 3
First Name: Former Three
Prior spouse died since marriage ended: Unknown

## SCHOOL INFORMATION`);
  const data = createClientData(createIntakeSession(parseIntake(input)));
  data.validationIssues.forEach(issue => { issue.dismissed = true; });
  data.reviewItems.forEach(item => { item.reviewed = true; });
  const profile = canonicalPracticeProfile(data);
  assert.deepEqual(profile.priorSpouseRecords, ['prior-spouse-1', 'prior-spouse-2', 'prior-spouse-3']);
  assert.equal(profile.fields.find(field => field.id === 'spouse.first-name@current-spouse')?.value, 'Synthetic');
  assert.equal(profile.fields.find(field => field.id === 'priorSpouses.first-name@prior-spouse-1')?.value, 'Former One');
  assert.equal(profile.fields.find(field => field.id === 'priorSpouses.first-name@prior-spouse-2')?.value, 'Former Two');
  assert.equal(profile.fields.find(field => field.id === 'priorSpouses.middle-name@prior-spouse-1')?.value, 'Middle One');
  assert.equal(profile.fields.find(field => field.id === 'priorSpouses.name-at-birth@prior-spouse-1')?.value, 'Birth One');
  assert.equal(profile.fields.find(field => field.id === 'priorSpouses.name-at-birth@prior-spouse-2')?.value, 'Birth Two');
  assert.notEqual(profile.fields.find(field => field.definitionId === 'priorSpouses.middle-name')?.value,
    profile.fields.find(field => field.definitionId === 'priorSpouses.name-at-birth')?.value);
  assert.equal(profile.fields.find(field => field.id === 'priorSpouses.prior-spouse-died-since-marriage-ended@prior-spouse-1')?.value, 'Yes');
  assert.equal(profile.fields.find(field => field.id === 'priorSpouses.prior-spouse-died-since-marriage-ended@prior-spouse-2')?.value, 'No');
  assert.equal(profile.fields.find(field => field.id === 'priorSpouses.prior-spouse-died-since-marriage-ended@prior-spouse-3')?.value, 'Unknown');
  const practicePlan = planPractice(profile);
  assert.equal(practicePlan.find(item => item.target === 'prior-first-name' && item.recordId === 'prior-spouse-1')?.value, 'Former One');
  assert.equal(practicePlan.find(item => item.target === 'prior-first-name' && item.recordId === 'prior-spouse-2')?.value, 'Former Two');
  assert.equal(practicePlan.find(item => item.target === 'prior-middle-name' && item.recordId === 'prior-spouse-2')?.status, 'pause');
  const projected = projectReady(profile);
  assert.deepEqual(projected.priorSpouseRecords, profile.priorSpouseRecords);
  assert(projected.fields.every(field => field.readiness === 'ready' && field.blockingReasons.length === 0));
  assert(JSON.stringify(projected).includes('Middle One'));
  assert(JSON.stringify(projected).includes('Birth One'));
  assert(!projected.fields.some(field => field.definitionId === 'spouse.first-name' && field.value === 'Former One'));
});

test('prior spouse missing, unsupported, ambiguous, and invalid values do not transfer', () => {
  const input = completeSyntheticIntake().replace('\n## SCHOOL INFORMATION', `
Previous Spouse 1
First Name: Former One
First Name: Different Former
Marriage Date: 01/2001
Marriage End Date: 02/30/2005
Prior spouse died since marriage ended: Maybe
Unapproved Field: Do not transfer

## SCHOOL INFORMATION`);
  const data = createClientData(createIntakeSession(parseIntake(input)));
  data.validationIssues.forEach(issue => { issue.dismissed = true; });
  data.reviewItems.forEach(item => { item.reviewed = true; });
  const profile = canonicalPracticeProfile(data);
  assert.deepEqual(profile.priorSpouseRecords, ['prior-spouse-1']);
  assert(!profile.fields.some(field => field.definitionId === 'priorSpouses.first-name'));
  assert(!profile.fields.some(field => field.definitionId === 'priorSpouses.marriage-date'));
  assert(!profile.fields.some(field => field.definitionId === 'priorSpouses.marriage-end-date'));
  assert(!profile.fields.some(field => field.definitionId === 'priorSpouses.prior-spouse-died-since-marriage-ended'));
  assert(!profile.fields.some(field => field.value === 'Do not transfer'));
  assert(planPractice(profile).filter(item => item.recordCategory === 'priorSpouses').every(item => item.status === 'pause'));
  assert.equal(projectReady(profile).priorSpouseRecords.length, 1);
  assert(!projectReady(profile).fields.some(field => field.definitionId.startsWith('priorSpouses.')));
});

test('child first and last names retain separate repeating record identities', () => {
  const input = completeSyntheticIntake().replace(/(## CHILDREN INFORMATION\n[\s\S]*?)(?=\n## )/,
    '$1\n#### Child 2\n**First Name:** Second\n**Last Name:** Fictional');
  const profile = canonicalPracticeProfile(createClientData(createIntakeSession(parseIntake(input))));
  assert.equal(profile.fields.find(field => field.id === 'children.first-name@child-1')?.value, 'Synthetic');
  assert.equal(profile.fields.find(field => field.id === 'children.first-name@child-2')?.value, 'Second');
  assert.equal(profile.fields.find(field => field.id === 'children.last-name@child-2')?.value, 'Fictional');
});
