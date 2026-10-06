import { intakeRules } from '../../../intake-checker/rules.js';
import { reviewFields } from '../../../intake-checker/review-fields.js';

// This catalog describes EXISTING labels; it does not change what the parser accepts.
export const PROFILE_SCHEMA_VERSION = '3.0.0';
export const FIELD_TYPES = Object.freeze(['text', 'boolean', 'date']);
const sectionIds = {
  'PERSONAL INFORMATION': 'personal', 'BIRTH INFORMATION': 'birth',
  'ADDRESS INFORMATION': 'address', 'LANGUAGE INFORMATION': 'language',
  'SECURITY QUESTIONS': 'security-questions', VEHICLES: 'vehicle-summary', VITALS: 'vitals',
  'EMPLOYMENT INFORMATION': 'employment', 'MARRIAGE INFORMATION': 'marriage',
  'SCHOOL INFORMATION': 'school', 'CHILDREN INFORMATION': 'child-summary',
};
const booleans = new Set([
  'Currently working', 'Have you ever worked', 'Used other names in medical records', 'Own any vehicles',
  ...reviewFields.filter(label => /Receive |Borrowing Money - Borrowing Money|Other Support -/.test(label)),
]);
function typeFor(label) {
  if (booleans.has(label) || label.startsWith('Can ')) return 'boolean';
  if (/date/i.test(label) || label === 'When did you last work') return 'date';
  // The Checker establishes strings, not numeric units, currencies or enumerations.
  return 'text';
}
const slug = label => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const fieldDefinitions = [];
function add(category, section, labels, extra = {}) {
  for (const label of new Set(labels)) fieldDefinitions.push(Object.freeze({
    id: `${category}.${slug(label)}`, category, section, label, dataType: typeFor(label), ...extra,
  }));
}
for (const [section, rule] of Object.entries(intakeRules.sections)) {
  add(sectionIds[section], section, [...(rule.required || []), ...(rule.optional || [])], { parent: rule.parent || null, record: false });
}
for (const [category, rule] of Object.entries(intakeRules.records)) {
  add(category, rule.section, [...(rule.required || []), ...(rule.optional || []), ...(rule.currentYearAddress || []), ...(rule.recognition || [])], { record: true });
}
add('providers', 'MEDICAL PROVIDERS', ['Last Visit Date'], { record: true });
add('employment', 'EMPLOYMENT INFORMATION', ['Have you ever worked'], { record: false });
add('other-names', 'OTHER NAMES', ['Used other names in medical records', 'Other first name', 'Other last name'], { record: false });
add('remarks', 'REMARKS/COMMENTS', ['Remarks/Comments'], { record: false });
add('disability', 'DISABILITY INFORMATION', ['Onset date of disability'], { record: false });
add('financial-support', 'FINANCIAL SUPPORT', reviewFields.filter(label => label !== 'Onset date of disability'), { record: false });
Object.freeze(fieldDefinitions);

export const medicalProblemDefinition = Object.freeze({
  id: 'medical-problems.problem', category: 'medical-problems', section: 'MEDICAL PROBLEMS',
  label: 'Numbered medical problem', dataType: 'text', record: true,
});

export function profileSummary(profile) {
  const fields = profile.fields;
  return {
    total: fields.length,
    received: fields.filter(field => field.sources.length > 0).length,
    ready: fields.filter(field => field.readiness === 'ready').length,
    blocked: fields.filter(field => field.readiness === 'blocked').length,
    missing: fields.filter(field => field.blockingReasons.some(reason => reason.code === 'missing')).length,
    conflicts: fields.filter(field => field.blockingReasons.some(reason => reason.code === 'conflict')).length,
  };
}

// Future consumers must also require an exact SSA question/definition mapping.
// Returning ready fields is a local projection, not an extension connection.
export function readyFields(profile) {
  if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION) return [];
  return profile.fields.filter(field => field.readiness === 'ready' && field.blockingReasons.length === 0 && field.value !== null);
}
