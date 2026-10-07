// These are invented practice questions, NOT verified SSA selectors or meanings.
export const schemaVersion = '3.0.0';
export const mappings = Object.freeze([
  ['first-name', 'First name', 'personal.first-name', 'text'],
  ['last-name', 'Last name', 'personal.last-name', 'text'],
  ['middle-name', 'Middle name (optional)', 'personal.middle-name', 'text'],
  ['suffix', 'Suffix (optional)', 'personal.suffix', 'text'],
  ['nickname', 'Nickname (optional)', 'personal.nickname', 'text'],
  ['gender', 'Gender as recorded in intake', 'personal.gender', 'text'],
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
].map(([target, label, definitionId, type, precision = 'day']) => Object.freeze({ target, label, definitionId, type, precision })));

export function planPractice(profile) {
  const supported = profile?.schema === 'packard.intake-client-profile' && profile.schemaVersion === schemaVersion && Array.isArray(profile.fields);
  return mappings.map(mapping => {
    const pause = reason => ({ ...mapping, status: 'pause', reason });
    if (!supported) return pause('Unsupported profile contract.');
    if (!mapping.definitionId) return pause('No exact mapping. Employee input required; no similar date will be substituted.');
    const candidates = profile.fields.filter(field => field.definitionId === mapping.definitionId);
    if (candidates.length !== 1 || candidates[0].recordId != null) return pause('No unique singleton answer.');
    const field = candidates[0];
    if (field.readiness !== 'ready' || !Array.isArray(field.blockingReasons) || field.blockingReasons.length || field.value == null) return pause('No ready answer. Leave blank for employee input if needed.');
    if (field.dataType !== mapping.type || (mapping.type === 'boolean'
      ? typeof field.value !== 'boolean' : typeof field.value !== 'string' || !field.value.trim())) return pause('Answer type does not match this question.');
    if (mapping.type === 'date' && (!['day', 'month'].includes(field.precision) || (mapping.precision === 'day' && field.precision !== 'day'))) return pause('A complete date is needed. No day will be guessed.');
    return { ...mapping, status: 'ready', value: field.value, fieldId: field.id };
  });
}

// Explicit click only. Refuse changed/duplicate targets and preserve existing values.
export function fillPractice(profile, root) {
  if (root?.dataset?.practice !== 'packard-synthetic-v1') return [];
  return planPractice(profile).map(item => {
    if (item.status !== 'ready') return item;
    const targets = root.querySelectorAll(`[data-practice-field="${item.target}"]`);
    const input = targets[0];
    const validTarget = item.type === 'boolean'
      ? input?.tagName === 'SELECT' && input.options?.length === 3
        && ['','yes','no'].every((value, index) => input.options[index].value === value)
      : input?.tagName === 'INPUT' && input.type === 'text' && !input.readOnly;
    if (targets.length !== 1 || !validTarget || input.disabled) return { ...item, status: 'pause', reason: 'Practice page changed. Target unavailable.' };
    if (input.value) return { ...item, status: 'pause', reason: 'Existing answer preserved.' };
    input.value = item.type === 'boolean' ? item.value ? 'yes' : 'no' : item.value;
    return { ...item, status: 'filled' };
  });
}
