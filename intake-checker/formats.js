import { intakeRules } from './rules.js';
import { isMissing, parseCalendarDate } from './values.js';

// Checker-owned policies. Unknown fields and free-text answers are never sanitized.
const labelsBySection = new Map();
function add(section, labels) {
  const known = labelsBySection.get(section) || new Set();
  labels.forEach(label => known.add(label));
  labelsBySection.set(section, known);
}
for (const [section, rule] of Object.entries(intakeRules.sections)) {
  add(section, [...(rule.required || []), ...(rule.optional || [])]);
}
for (const rule of Object.values(intakeRules.records)) {
  add(rule.section, [...(rule.required || []), ...(rule.optional || []), ...(rule.currentYearAddress || []), ...(rule.recognition || [])]);
}
add('MEDICAL PROVIDERS', ['Last Visit Date']);
add('OTHER NAMES', ['Other first name', 'Other last name']);
add('DISABILITY INFORMATION', ['Onset date of disability']);
add('FINANCIAL SUPPORT', ['Veteran Benefits - Monthly amount', 'Retirement/Pension - Monthly amount', 'Borrowing Money - Monthly amount']);

export function formatKind(section, label) {
  if (!labelsBySection.get(section)?.has(label)) return null;
  if (intakeRules.personNameFields[section]?.includes(label)) return 'name';
  if (/Phone/.test(label)) return 'phone';
  if (label === 'Social Security Number') return 'ssn';
  if (/Zipcode|Zip Code/.test(label)) return 'zip';
  if (label === 'Email') return 'email';
  if (/date/i.test(label) || label === 'When did you last work') return 'date';
  if (/Monthly amount/.test(label) || label === 'Rate of Pay') return 'amount';
  if (/Street Address|Address Line|^Address(?: 2)?$/.test(label)) return 'address';
  if (/City|State|Country/.test(label) || ['Clinic Name', 'Employer', 'School name where highest grade completed'].includes(label)) return 'place';
  return null;
}

const titleCase = text => text.toLowerCase().replace(/(^| )[\p{L}\p{M}]/gu, match => match.toUpperCase());

export function formatIntakeValue(section, label, source) {
  const kind = formatKind(section, label);
  if (!kind || isMissing(source)) return { kind, value: source, error: null };
  const raw = String(source).trim();
  const invalid = message => ({ kind, value: source, error: message });
  if (['name', 'place', 'address'].includes(kind)) {
    const allowed = kind === 'address' ? /[^\p{L}\p{M}\d\s]/gu : /[^\p{L}\p{M}\s]/gu;
    const value = titleCase(raw.normalize('NFC').replace(allowed, '').replace(/\s+/g, ' ').trim());
    if (!value) return invalid(`${label} must contain ${kind === 'address' ? 'letters or numbers' : 'letters'} after formatting.`);
    return { kind, value, error: null };
  }
  if (['phone', 'ssn', 'zip'].includes(kind)) {
    const length = { phone: 10, ssn: 9, zip: 5 }[kind];
    const digits = raw.replace(/\D/g, '');
    const formattingOnly = (kind === 'phone' ? /^[\d\s()+.\-]+$/ : /^[\d\s-]+$/).test(raw);
    if (!formattingOnly || digits.length !== length) return invalid(`${label} must contain exactly ${length} digits. Do not add or remove digits to make it fit.`);
    const value = kind === 'phone' ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
      : kind === 'ssn' ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;
    return { kind, value, error: null };
  }
  if (kind === 'email') {
    // Practical syntax check, not mailbox verification; preserve the exact source value/case.
    const parts = raw.split('@');
    const local = parts[0], domain = parts[1];
    const valid = parts.length === 2 && raw.length <= 254 && local.length <= 64
      && /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local)
      && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
      && domain.includes('.') && domain.split('.').every(part => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part));
    return valid ? { kind, value: source, error: null } : invalid(`${label} must be a valid email address, including @ and a domain such as example.test.`);
  }
  if (kind === 'date') {
    const date = parseCalendarDate(raw);
    if (!date) return invalid(`${label} must be a valid calendar date or month/year in a supported format.`);
    const month = String(date.month).padStart(2, '0');
    return { kind, value: date.precision === 'month' ? `${month}/${date.year}` : `${month}/${String(date.day).padStart(2, '0')}/${date.year}`, precision: date.precision, error: null };
  }
  if (kind === 'amount' && !/^\$?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
    return invalid(`${label} must contain digits with an optional decimal point and leading $.`);
  }
  return { kind, value: source, error: null };
}

// Results stay in page memory alongside original parser nodes; neither source nor offsets change.
export function inspectFormats(intake) {
  const results = new Map();
  const issues = [];
  const hasSchool = nodes => nodes.some(node => node.title === 'SCHOOL INFORMATION' || hasSchool(node.subsections));
  const schoolFallback = !hasSchool(intake.sections);
  function visit(nodes, parentPath = '', parentSection = null) {
    nodes.forEach((node, index) => {
      const location = `${parentPath}/${index}`;
      const section = labelsBySection.has(node.title) ? node.title
        : node.title === 'EDUCATION INFORMATION' && schoolFallback ? 'SCHOOL INFORMATION' : parentSection;
      for (const field of node.fields) {
        const result = formatIntakeValue(section, field.label, field.value);
        results.set(field, result);
        if (result.error) issues.push({ section, ...(node.title !== section && node.title !== 'EDUCATION INFORMATION' ? { record: node.title } : {}), location, field: field.label, severity: 'error', message: result.error });
      }
      visit(node.subsections, location, section);
    });
  }
  visit(intake.sections);
  return { results, issues };
}
