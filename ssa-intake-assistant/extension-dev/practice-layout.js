// Fictional review layout supplied by staff. These are not verified SSA questions or selectors.
const row = (label, target = null, key = null) => Object.freeze({ label, target, key: key || target });
export const formSections = Object.freeze([
  { title: 'Applicant’s Name', rows: [row('First', 'first-name'), row('Middle', 'middle-name'), row('Last', 'last-name'), row('Suffix', 'suffix')] },
  { title: 'Social Security Number (SSN)', rows: [row('SSN', 'ssn')] },
  { title: 'Date of Birth', rows: [row('Month', null, 'birth-month'), row('Day', null, 'birth-day'), row('Year', null, 'birth-year')] },
  { title: 'Sex', rows: [row('Answer from PERSONAL INFORMATION / Gender', 'gender')] },
  { title: 'Is the applicant blind?', rows: [row('Answer from MEDICAL INFORMATION / BlindOrHaveLowVision', 'applicant-blind')] },
  { title: 'In the last 14 months, SGA?', rows: [row('Answer', null, 'recent-sga')] },
  { title: 'Other Names', rows: [row('Other First Name', 'other-first-name'), row('Other Middle Name', 'other-middle-name'), row('Other Last Name', 'other-last-name'), row('Suffix', 'other-suffix')] },
  { title: 'Marriage Information — Current Spouse', rows: [
    row('Spouse’s First Name', 'current-spouse-first'), row('Spouse’s Last Name', 'current-spouse-last'),
    row('Spouse’s Social Security Number', 'current-spouse-ssn'), row('Does applicant know spouse’s DOB?', null, 'current-spouse-knows-dob'),
    row('Spouse’s DOB Month', null, 'current-spouse-birth-month'), row('Spouse’s DOB Day', null, 'current-spouse-birth-day'), row('Spouse’s DOB Year', null, 'current-spouse-birth-year'),
    row('Spouse Age', 'current-spouse-age'), row('Date of Marriage Month', null, 'current-marriage-month'),
    row('Date of Marriage Day', null, 'current-marriage-day'), row('Date of Marriage Year', null, 'current-marriage-year'),
    row('Place of Marriage City/Town', 'current-marriage-city'), row('Place of Marriage State', 'current-marriage-state'),
    row('Marriage Type', 'current-marriage-type'),
  ] },
  { title: 'Prior Marriages', rows: [
    row('First Name', 'prior-first-name'), row('Middle Name', 'prior-middle-name'), row('Last Name', 'prior-last-name'),
    row('Name at Birth', 'prior-name-at-birth'), row('Social Security Number', 'prior-ssn'),
    row('Birth Country', 'prior-birth-country'), row('Birth City', 'prior-birth-city'), row('Birth State', 'prior-birth-state'),
    row('Age', 'prior-age'), row('City of Marriage', 'prior-marriage-city'), row('State of Marriage', 'prior-marriage-state'),
    row('Type of Marriage', 'prior-marriage-type'), row('Marriage Date', 'prior-marriage-date'),
    row('How Marriage Ended', 'prior-how-marriage-ended'), row('Marriage End Date', 'prior-marriage-end-date'),
    row('City where marriage ended', 'prior-ended-city'), row('State where marriage ended', 'prior-ended-state'),
    row('Prior spouse died since marriage ended', 'prior-spouse-died'),
  ] },
  { title: 'Children', rows: [row('Child information — not mapped yet', null, 'children-not-mapped')] },
]);
export const employmentRows = Object.freeze([
  row('Job Title', 'employment-job-title'),
  row('Employer name', 'employment-employer'),
  row('Business Type', 'employment-business-type'),
  row('Street Line 1', 'employment-street-line-1'),
  row('City/Town', 'employment-city'),
  row('State/Territory', 'employment-state'),
  row('ZIP Code', 'employment-zip'),
  row('Hours per Day', 'employment-hours-per-day'),
  row('Days per Week', 'employment-days-per-week'),
  row('Rate of Pay', 'employment-rate-of-pay'),
  row('Pay Frequency', 'employment-pay-frequency'),
  row('Start Date Month', null, 'employment-start-month'),
  row('Start Date Year', null, 'employment-start-year'),
  row('End Date Month', null, 'employment-end-month'),
  row('End Date Year', null, 'employment-end-year'),
  row('Employed in 2025 — not mapped', 'employment-2025'),
  row('Employed in 2026 — not mapped', 'employment-2026'),
  row('Employed in 2027 — not mapped', 'employment-2027'),
  row('Country — not mapped', 'employment-country'),
  row('Street Line 2 — not mapped', 'employment-street-line-2'),
  row('Employment has not ended — not mapped', 'employment-not-ended'),
]);
export const employmentQuestionRows = Object.freeze([
  row('Did Applicant work outside of USA', 'worked-outside-us'),
  row('Is applicant eligible for benefits', 'eligible-foreign-ssi'),
  row('What country are they eligible', 'foreign-ssi-country'),
]);
export const previousApplicationRows = Object.freeze([
  row('Previous Application', 'previous-application'),
]);
export const workConditionRows = Object.freeze([
  row('Conditions related to work', 'conditions-related-to-work'),
  row('Expect to receive more money', 'expect-to-receive-more-money'),
]);
