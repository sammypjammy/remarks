// These are invented practice questions, NOT verified SSA selectors or meanings.
export const schemaVersion = '3.2.0';
export const mappings = Object.freeze([
  ['first-name', 'First name', 'personal.first-name', 'text'],
  ['last-name', 'Last name', 'personal.last-name', 'text'],
  ['middle-name', 'Middle name (optional)', 'personal.middle-name', 'text'],
  ['suffix', 'Suffix (optional)', 'personal.suffix', 'text'],
  ['nickname', 'Nickname (optional)', 'personal.nickname', 'text'],
  ['gender', 'Gender as recorded in intake', 'personal.gender', 'text'],
  ['applicant-blind', 'Blind or low vision as recorded in intake', 'medical-information.blindorhavelowvision', 'boolean'],
  ['ssn', 'Social Security number', 'personal.social-security-number', 'text'],
  ['phone', 'Phone number', 'personal.phone-number', 'text'],
  ['alternate-phone', 'Alternate phone (optional)', 'personal.alternate-phone', 'text'],
  ['secondary-phone', 'Secondary phone (optional)', 'personal.secondary-phone', 'text'],
  ['email', 'Email', 'personal.email', 'text'],
  ['preferred-language', 'Preferred language', 'language.preferred-language', 'text'],
  ['speak-english', 'Can speak and understand English', 'language.can-speak-and-understand-english', 'boolean'],
  ['read-english', 'Can read simple English messages', 'language.can-read-simple-english-messages', 'boolean'],
  ['write-english', 'Can write simple English messages', 'language.can-write-simple-english-messages', 'boolean'],
  ['read-preferred', 'Can read simple messages in preferred language', 'language.can-read-simple-messages-in-preferred-language', 'boolean'],
  ['write-preferred', 'Can write simple messages in preferred language', 'language.can-write-simple-messages-in-preferred-language', 'boolean'],
  ['mother-first-name', 'Mother first name', 'security-questions.mother-first-name', 'text'],
  ['mother-maiden-name', 'Mother maiden name', 'security-questions.mother-maiden-name', 'text'],
  ['father-first-name', 'Father first name', 'security-questions.father-first-name', 'text'],
  ['father-last-name', 'Father last name', 'security-questions.father-last-name', 'text'],
  ['other-legal-representative', 'Other legal representative', 'security-questions.other-legal-representative', 'text'],
  ['height-feet', 'Height (feet)', 'vitals.height-feet', 'text'],
  ['height-inches', 'Height (inches, optional)', 'vitals.height-inches', 'text'],
  ['weight-pounds', 'Weight (pounds)', 'vitals.weight-pounds', 'text'],
  ['other-first-name', 'Other first name', 'other-names.other-first-name', 'text'],
  ['other-middle-name', 'Other middle name — not mapped', null, 'text'],
  ['other-last-name', 'Other last name', 'other-names.other-last-name', 'text'],
  ['other-suffix', 'Other suffix — not mapped', null, 'text'],
  ['current-spouse-first', 'Current spouse first name', 'spouse.first-name', 'text', 'day', 'spouse'],
  ['current-spouse-last', 'Current spouse last name', 'spouse.last-name', 'text', 'day', 'spouse'],
  ['current-spouse-ssn', 'Current spouse SSN', 'spouse.social-security-number', 'text', 'day', 'spouse'],
  ['current-spouse-age', 'Current spouse age', 'spouse.age', 'text', 'day', 'spouse'],
  ['current-marriage-date', 'Current marriage date', 'spouse.marriage-date', 'date', 'day', 'spouse'],
  ['current-marriage-city', 'Current marriage city', 'spouse.city-of-marriage', 'text', 'day', 'spouse'],
  ['current-marriage-state', 'Current marriage state', 'spouse.state-of-marriage', 'text', 'day', 'spouse'],
  ['current-marriage-type', 'Current marriage type', 'spouse.type-of-marriage', 'text', 'day', 'spouse'],
  ['birth-date', 'Date of birth (full date)', 'birth.date-of-birth', 'date'],
  ['birth-city', 'City of birth', 'birth.city-of-birth', 'text'],
  ['birth-state', 'State of birth', 'birth.state-of-birth', 'text'],
  ['birth-country', 'Country of birth', 'birth.country-of-birth', 'text'],
  ['mailing-street', 'Mailing street address', 'address.mailing-address-street-address', 'text'],
  ['mailing-city', 'Mailing city', 'address.mailing-address-city', 'text'],
  ['mailing-state', 'Mailing state', 'address.mailing-address-state', 'text'],
  ['mailing-zip', 'Mailing ZIP code', 'address.mailing-address-zipcode', 'text'],
  ['physical-street', 'Physical street address', 'address.physical-address-street-address', 'text'],
  ['physical-street-2', 'Physical address line 2 (optional)', 'address.physical-address-street-address-2', 'text'],
  ['physical-city', 'Physical city', 'address.physical-address-city', 'text'],
  ['physical-state', 'Physical state', 'address.physical-address-state', 'text'],
  ['physical-zip', 'Physical ZIP code', 'address.physical-address-zipcode', 'text'],
  ['onset', 'Disability onset (month accepted)', 'disability.onset-date-of-disability', 'date', 'month'],
  ['last-worked', 'Last day worked (full date)', 'employment.when-did-you-last-work', 'date'],
  ['work-stopped', 'Date work stopped — not mapped', null, 'date'],
  ['employment-employer', 'Employer name', 'jobs.employer', 'text', 'day', 'jobs'],
  ['employment-street-line-1', 'Street Line 1', 'jobs.address', 'text', 'day', 'jobs'],
  ['employment-city', 'City/Town', 'jobs.city', 'text', 'day', 'jobs'],
  ['employment-state', 'State/Territory', 'jobs.state', 'text', 'day', 'jobs'],
  ['employment-zip', 'ZIP Code', 'jobs.zipcode', 'text', 'day', 'jobs'],
  ['employment-start-date', 'Start Date', 'jobs.start-date', 'date', 'day', 'jobs'],
  ['employment-end-date', 'End Date', 'jobs.end-date', 'date', 'day', 'jobs'],
  ['employment-2025', 'Employed in 2025 — not mapped', null, 'text', 'day', 'jobs'],
  ['employment-2026', 'Employed in 2026 — not mapped', null, 'text', 'day', 'jobs'],
  ['employment-2027', 'Employed in 2027 — not mapped', null, 'text', 'day', 'jobs'],
  ['employment-country', 'Country — not mapped', null, 'text', 'day', 'jobs'],
  ['employment-street-line-2', 'Street Line 2 — not mapped', null, 'text', 'day', 'jobs'],
  ['employment-not-ended', 'Employment has not ended — not mapped', null, 'text', 'day', 'jobs'],
  ['prior-first-name', 'First Name', 'priorSpouses.first-name', 'text', 'day', 'priorSpouses'],
  ['prior-middle-name', 'Middle Name', 'priorSpouses.middle-name', 'text', 'day', 'priorSpouses'],
  ['prior-last-name', 'Last Name', 'priorSpouses.last-name', 'text', 'day', 'priorSpouses'],
  ['prior-name-at-birth', 'Name at Birth', 'priorSpouses.name-at-birth', 'text', 'day', 'priorSpouses'],
  ['prior-ssn', 'Social Security Number', 'priorSpouses.social-security-number', 'text', 'day', 'priorSpouses'],
  ['prior-birth-country', 'Birth Country', 'priorSpouses.birth-country', 'text', 'day', 'priorSpouses'],
  ['prior-birth-city', 'Birth City', 'priorSpouses.birth-city', 'text', 'day', 'priorSpouses'],
  ['prior-birth-state', 'Birth State', 'priorSpouses.birth-state', 'text', 'day', 'priorSpouses'],
  ['prior-age', 'Age', 'priorSpouses.age', 'text', 'day', 'priorSpouses'],
  ['prior-marriage-city', 'City of Marriage', 'priorSpouses.city-of-marriage', 'text', 'day', 'priorSpouses'],
  ['prior-marriage-state', 'State of Marriage', 'priorSpouses.state-of-marriage', 'text', 'day', 'priorSpouses'],
  ['prior-marriage-type', 'Type of Marriage', 'priorSpouses.type-of-marriage', 'text', 'day', 'priorSpouses'],
  ['prior-marriage-date', 'Marriage Date', 'priorSpouses.marriage-date', 'date', 'day', 'priorSpouses'],
  ['prior-how-marriage-ended', 'How Marriage Ended', 'priorSpouses.how-marriage-ended', 'text', 'day', 'priorSpouses'],
  ['prior-marriage-end-date', 'Marriage End Date', 'priorSpouses.marriage-end-date', 'date', 'day', 'priorSpouses'],
  ['prior-ended-city', 'City where marriage ended', 'priorSpouses.city-where-marriage-ended', 'text', 'day', 'priorSpouses'],
  ['prior-ended-state', 'State where marriage ended', 'priorSpouses.state-where-marriage-ended', 'text', 'day', 'priorSpouses'],
  ['prior-spouse-died', 'Prior spouse died since marriage ended', 'priorSpouses.prior-spouse-died-since-marriage-ended', 'text', 'day', 'priorSpouses', ['Yes', 'No', 'Unknown']],
].map(([target, label, definitionId, type, precision = 'day', recordCategory = null, allowedValues = null]) =>
  Object.freeze({ target, label, definitionId, type, precision, recordCategory, allowedValues })));

export const childDefinitionIds = Object.freeze(['children.first-name', 'children.last-name']);
export const jobDefinitionIds = Object.freeze([
  'jobs.employer', 'jobs.address', 'jobs.city', 'jobs.state', 'jobs.zipcode', 'jobs.start-date', 'jobs.end-date',
]);

export function isFullDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function planPractice(profile) {
  const supported = profile?.schema === 'packard.intake-client-profile' && profile.schemaVersion === schemaVersion
    && Array.isArray(profile.fields) && Array.isArray(profile.priorSpouseRecords) && Array.isArray(profile.jobRecords);
  const priorRecords = profile?.priorSpouseRecords;
  const validPriorRecords = Array.isArray(priorRecords) && priorRecords.every((recordId, index) =>
    typeof recordId === 'string' && /^prior-spouse-[1-9]\d*$/.test(recordId)
      && priorRecords.indexOf(recordId) === index);
  const jobRecords = profile?.jobRecords;
  const validJobRecords = Array.isArray(jobRecords) && jobRecords.every((recordId, index) =>
    typeof recordId === 'string' && /^job-[1-9]\d*$/.test(recordId)
      && jobRecords.indexOf(recordId) === index);
  const plannedMappings = mappings.flatMap(mapping => mapping.recordCategory === 'priorSpouses'
    ? validPriorRecords ? priorRecords.map(recordId => ({ ...mapping, recordId })) : [{ ...mapping, recordId: null, invalidRecords: true }]
    : mapping.recordCategory === 'jobs'
      ? validJobRecords ? jobRecords.map(recordId => ({ ...mapping, recordId })) : [{ ...mapping, recordId: null, invalidRecords: true }]
      : [mapping]);
  return plannedMappings.map(mapping => {
    const pause = reason => ({ ...mapping, status: 'pause', reason });
    if (!supported) return pause('Unsupported profile contract.');
    if (mapping.invalidRecords) return pause('Repeating record identities are invalid.');
    if (!mapping.definitionId) return pause('No exact Checker field. Employee input required; no answer will be guessed.');
    const recordId = mapping.recordCategory === 'spouse' ? 'current-spouse'
      : ['priorSpouses', 'jobs'].includes(mapping.recordCategory) ? mapping.recordId : null;
    const candidates = profile.fields.filter(field => field.definitionId === mapping.definitionId && field.recordId === recordId);
    if (candidates.length !== 1) return pause('No unique matching answer.');
    const field = candidates[0];
    if (field.readiness !== 'ready' || !Array.isArray(field.blockingReasons) || field.blockingReasons.length || field.value == null) return pause('No ready answer. Leave blank for employee input if needed.');
    if (field.dataType !== mapping.type || (mapping.type === 'boolean'
      ? typeof field.value !== 'boolean' : typeof field.value !== 'string' || !field.value.trim())) return pause('Answer type does not match this question.');
    if (mapping.allowedValues && !mapping.allowedValues.includes(field.value)) return pause('Answer is outside the exact supported choices.');
    if (mapping.type === 'date' && (!['day', 'month'].includes(field.precision)
      || (mapping.precision === 'day' && (field.precision !== 'day' || !isFullDate(field.value))))) return pause('A complete date is needed. No day will be guessed.');
    return { ...mapping, status: 'ready', value: field.value, fieldId: field.id };
  });
}

// Explicit click only. Refuse changed/duplicate targets and preserve existing values.
export function fillPractice(profile, root) {
  if (root?.dataset?.practice !== 'packard-synthetic-v1') return [];
  return planPractice(profile).map(item => {
    if (item.status !== 'ready') return item;
    const selector = item.recordId
      ? `[data-practice-field="${item.target}"][data-practice-record="${item.recordId}"]`
      : `[data-practice-field="${item.target}"]`;
    const targets = root.querySelectorAll(selector);
    const input = targets[0];
    const validTarget = item.type === 'boolean'
      ? input?.tagName === 'SELECT' && input.options?.length === 3
        && ['','yes','no'].every((value, index) => input.options[index].value === value)
      : item.allowedValues
        ? input?.tagName === 'SELECT' && input.options?.length === item.allowedValues.length + 1
          && input.options[0].value === '' && item.allowedValues.every((value, index) => input.options[index + 1].value === value)
        : input?.tagName === 'INPUT' && input.type === 'text' && !input.readOnly;
    if (targets.length !== 1 || !validTarget || input.disabled) return { ...item, status: 'pause', reason: 'Practice page changed. Target unavailable.' };
    if (input.value) return { ...item, status: 'pause', reason: 'Existing answer preserved.' };
    input.value = item.type === 'boolean' ? item.value ? 'yes' : 'no' : item.value;
    return { ...item, status: 'filled' };
  });
}
