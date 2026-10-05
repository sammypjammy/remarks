import { sourceRange } from '../../../intake-checker/parser.js';
import { isMissing, parseCalendarDate } from '../../../intake-checker/validation.js';
import { createClientProfile, createField } from './client-schema.js';

// Exact source sections prevent spouse/provider details from becoming client answers.
export const intakeMappings = [
  ['personal.firstName', 'PERSONAL INFORMATION', ['First Name']],
  ['personal.middleName', 'PERSONAL INFORMATION', ['Middle Name']],
  ['personal.lastName', 'PERSONAL INFORMATION', ['Last Name']],
  ['personal.suffix', 'PERSONAL INFORMATION', ['Suffix']],
  ['personal.ssn', 'PERSONAL INFORMATION', ['Social Security Number']],
  ['personal.dateOfBirth', 'BIRTH INFORMATION', ['Date of Birth']],
  ['contact.phone', 'PERSONAL INFORMATION', ['Phone Number']],
  ['contact.alternatePhone', 'PERSONAL INFORMATION', ['Alternate Phone', 'Secondary Phone']],
  ['contact.email', 'PERSONAL INFORMATION', ['Email']],
  ['contact.mailingAddress.street1', 'ADDRESS INFORMATION', ['Mailing Address - Street Address']],
  ['contact.mailingAddress.street2', 'ADDRESS INFORMATION', ['Mailing Address - Street Address 2']],
  ['contact.mailingAddress.city', 'ADDRESS INFORMATION', ['Mailing Address - City']],
  ['contact.mailingAddress.state', 'ADDRESS INFORMATION', ['Mailing Address - State']],
  ['contact.mailingAddress.zip', 'ADDRESS INFORMATION', ['Mailing Address - Zipcode']],
];

export function fromIntakeChecker({ parsed, report, review, validationState, reviewState }) {
  const profile = createClientProfile();
  const remaining = validationState.remaining();
  const remainingReview = reviewState.remaining();
  profile.source = {
    kind: 'intake-checker', transferredCount: 0,
    intakeIssues: report.issues.map(issue => ({ ...issue, reviewed: !remaining.includes(issue) })),
    reviewItems: review.items.map(item => ({ ...item, reviewed: !remainingReview.includes(item) })),
    parsingNeedsReview: parsed.unparsed.length > 0,
  };
  for (const [path, section, labels] of intakeMappings) {
    const sections = parsed.sections.filter(node => node.title === section);
    const candidates = sections.flatMap(node => node.fields.filter(field => labels.includes(field.label)));
    const available = candidates.filter(field => !isMissing(field.value));
    const values = [...new Set(available.map(field => field.value.trim()))];
    const conflict = values.length > 1 || (sections.length > 1 && available.length > 0);
    let value = values[0] || '';
    if (path === 'personal.dateOfBirth' && value) {
      const date = parseCalendarDate(value);
      if (date?.precision === 'day') value = `${String(date.month).padStart(2, '0')}/${String(date.day).padStart(2, '0')}/${date.year}`;
    }
    const field = createField(value, {
      status: conflict ? 'conflict' : value ? 'needs_review' : 'missing',
      employeeConfirmed: false,
      sourceLocations: candidates.map(item => ({ section, label: item.label, range: sourceRange(item) })).filter(item => item.range),
      candidates: candidates.map(item => ({ value: item.value, range: sourceRange(item) })),
      intakeIssues: profile.source.intakeIssues.filter(issue => issue.section === section && (!issue.field || labels.includes(issue.field))),
      notes: conflict ? 'Multiple source answers or sections. Resolve against the intake before confirming.' : value ? 'Transferred from the current pasted intake. Verify the SSA meaning before confirming.' : '',
    });
    if (values.length > 1) field.notes += ' Source alternatives: ' + values.join(' / ');
    const keys = path.split('.'); const key = keys.pop();
    keys.reduce((node, part) => node[part], profile)[key] = field;
    if (value) profile.source.transferredCount++;
  }
  return profile;
}
