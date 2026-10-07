import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntake } from '../intake-checker/parser.js';
import { createIntakeSession, correctIntakeField } from '../intake-checker/session.js';
import { createClientData } from '../intake-checker/client-data.js';
import { canonicalPracticeProfile } from '../ssa-intake-assistant/src/model/canonical-practice-profile.js';
import { mappings, planPractice } from '../ssa-intake-assistant/extension-dev/mapping.js';
import { projectReady } from '../ssa-intake-assistant/extension-dev/bridge-contract.js';
import { completeSyntheticIntake } from '../ssa-intake-assistant/tests/complete-intake.mjs';

const canonical = () => createClientData(createIntakeSession(parseIntake(completeSyntheticIntake())));

test('canonical Checker data projects only exact ready practice questions', () => {
  const data = canonical(), profile = canonicalPracticeProfile(data);
  const ids = mappings.filter(mapping => mapping.definitionId).map(mapping => mapping.recordCategory === 'spouse'
    ? `${mapping.definitionId}@current-spouse` : mapping.definitionId).concat(['children.first-name@child-1', 'children.last-name@child-1']);
  assert.deepEqual(profile.fields.map(field => field.id), ids);
  assert.equal(profile.schema, 'packard.intake-client-profile');
  assert.equal(profile.schemaVersion, '3.0.0');
  assert.equal(planPractice(profile).filter(item => item.status === 'ready').length, 51);
  assert.deepEqual(projectReady(profile), profile);
  assert(!JSON.stringify(profile).includes('Synthetic condition'));
  for (const field of profile.fields) assert.deepEqual(Object.keys(field).sort(),
    ['id', 'definitionId', 'recordId', 'dataType', 'value', 'precision', 'readiness', 'blockingReasons'].sort());
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

test('child first and last names retain separate repeating record identities', () => {
  const input = completeSyntheticIntake().replace(/(## CHILDREN INFORMATION\n[\s\S]*?)(?=\n## )/,
    '$1\n#### Child 2\n**First Name:** Second\n**Last Name:** Fictional');
  const profile = canonicalPracticeProfile(createClientData(createIntakeSession(parseIntake(input))));
  assert.equal(profile.fields.find(field => field.id === 'children.first-name@child-1')?.value, 'Synthetic');
  assert.equal(profile.fields.find(field => field.id === 'children.first-name@child-2')?.value, 'Second');
  assert.equal(profile.fields.find(field => field.id === 'children.last-name@child-2')?.value, 'Fictional');
});
