# Canonical Intake Checker client data

Schema: `packard.intake-checker.client-data`, version **1.0.0**. Owner: Intake Checker. `createClientData(session)` in `client-data.js` creates a detached, JSON-compatible snapshot of the active session. It uses existing parser nodes, format results, validation issues, review items, acknowledgements and edit ledger. It does not parse or validate a second time. Application release: Intake Checker v1.16.0.

## Coverage audit

The audit examined `parser.js`, `rules.js`, `formats.js`, `validation.js`, `review.js`, `review-fields.js`, `answers.js`, `medical-problems.js`, `source-location.js`, `acknowledgements.js`, `session.js`, the Checker UI, and the former SSA catalog/adapter. It also reconciled the parser, format, validation, review, duplicate, nested-record, source-location, acknowledgement, document-header and SSA adapter tests. Only generated synthetic fixtures were used.

There are **138 fixed field definitions across 22 categories**, plus an unbounded numbered medical-problem family. Seven repeating record types are vehicles, providers, medications, jobs, Current Spouse, Previous Spouse and children. Previous Spouse N records have their own supported field IDs and retain a record heading source even when individual values are absent. Optional record groups produce no hypothetical records. Every actual node, field occurrence, unknown label and unparsed line is retained. Blank fixed singleton definitions are included even if the section is absent. Missing fields on actual recognized records are included. Consequently a snapshot's field count is not a fixed 138.

The catalog now resides in `field-catalog.js`; the parser uses it for the existing plain labels. SSA's `intake-contract.js` re-exports these definitions as compatibility metadata. Its separate 3.2.0 SSA practice projection is not the canonical client-data schema. Only exact ready employment values and prior-spouse values are eligible for the synthetic practice extension; no live SSA interaction or automation is present.

## Object structure

| Property | Meaning |
| --- | --- |
| `schema`, `schemaVersion`, `toolVersion` | Contract identity, contract version, Checker release |
| `revision` | Existing correction revision; review changes do not increment it |
| `validationPerformed` | False for unrecognized-only input, whose original text can still be inspected |
| `source` | Original intake text and optional recognized export-header range; never used to infer identity |
| `scopes` | All sections and nested groups, parent IDs, original node paths, heading ranges, recognized record types, field IDs, original occurrence order |
| `fields` | Every known field in its actual subject scope, explicit missing singleton fields, and all unmapped fields |
| `validationIssues` | Every existing Checker issue, unchanged message/severity/context, source ranges, dismissal flag, related field IDs |
| `reviewItems` | Every triggered existing review notice, source range where available, reviewed flag, related field IDs |
| `unparsed` | All unmatched text with line numbers, exact ranges, scope IDs and validation-issue references |
| `deferred` | Existing unsupported validation notices: prior marriage and Total Earnings |
| `derived` | Existing display summary, review identifier/email, and exact-text distinct medical-problem count; explicitly not independently validated answers |
| `coverage` | Catalog count, parsed/current/preserved occurrence counts, scope/field/definition counts, unmapped fields and unparsed lines |

Each field has a stable `definitionId`, scope-qualified `id`, `scopeId`, `recordId` when repeating, label, category, declared type, supported/parsed flags, typed value, `valueStatus`, date precision, origin, validation references and review references. Job and prior-spouse fields also carry the actual record heading's `recordSource`, including when the value is missing. `occurrences` preserves every competing/identical source, original value, current value, formatted value, formatting result, exact range and employee correction ledger. Field values are never used in identifiers. Unknown labels are URI-encoded, not reduced to collision-prone slugs.

Definition IDs retain existing meanings such as `personal.first-name`, `disability.onset-date-of-disability` and `employment.when-did-you-last-work`. Scope IDs combine exact heading text and same-heading sibling ordinals. They remain stable across review, value corrections and unrelated-section insertion. Reordering identically named records or changing headings in a new pasted intake may change instance IDs; they are not permanent client/record IDs. Numbered medical slots stay separate even when answers match. Identical answers are only deduplicated in the existing derived distinct-problem count. Snapshot issue/review IDs are references within that snapshot, not durable IDs across revalidation.

Allowed types are `text`, `boolean` and `date`. Explicit Yes/True and No/False are encoded as booleans. Dates use ISO day or month form with explicit precision, after the Checker's existing calendar parser accepts them. Numeric amounts, units, phone numbers, ZIP codes, SSNs, enumerations and other values remain strings; no currency, units or codes are invented. Formatting follows `formats.js` exactly. Original and corrected source strings remain available alongside typed values.

## Quality, validation and review are separate

| `valueStatus` | Meaning |
| --- | --- |
| `value` | A supported representable value; validation/review must still be read |
| `missing` | Blank, Not provided, or absent according to the existing Checker's missing policy |
| `invalid` | Existing format error or an impossible/unrecognized calendar date; source preserved, typed value null |
| `ambiguous` | A nonexplicit boolean or repeated singleton subject; source preserved, typed value null |
| `conflict` | Existing answer-resolution or Checker conflict; all candidates preserved, typed value null |
| `uninterpreted` | An unmapped field's exact text is preserved without claiming its meaning |

`validation.hasErrors` continues to indicate errors even after employee dismissal. `unresolvedIssueIds` and `dismissedIssueIds` record UI decisions independently. A valid-looking date can still have a cross-field ordering error; `valueStatus: value` is not an assertion of overall validity. Review flags are separate annotations. No automatic confirmation or SSA readiness is assigned. Missing or invalid values cannot become valid because a notification was ignored. Text placeholders beyond the Checker's current blank/Not provided policy are not given new validation rules in this milestone; the older SSA projection has stricter placeholder rules. This distinction is documented rather than silently changing the Checker.

## All current rule families and dependencies

| Existing behavior | Canonical representation | Implementation and regression evidence |
| --- | --- | --- |
| Required personal/birth/address/language/vitals fields; school name/city/state only; optional remaining configured fields | Explicit missing fields plus exact individual/grouped validation issues | `rules.js`, `validation.js`; `tests/intake-validation.test.js` |
| Employment last-work exemption only for explicit No/false to ever worked | Existing issue outcome, separate ever-worked/currently-working/last-work fields | `validation.js`; `tests/intake-audit-fixes.test.js` |
| Job required fields; address only when End Date is in current local calendar year | Per-record values and existing required issues; no new date policy | `validation.js`; `tests/intake-validation.test.js` |
| Provider clinic or doctor name; Last Visit required when First Visit supplied; first/last order; same-month precision review; Next Visit current/future month | Per-record missing/error/warning issues with actual acknowledgement state | `validation.js`; `tests/intake-validation.test.js`, `tests/intake-audit-fixes.test.js` |
| Married requires Current Spouse details; duplicate errors apply only to multiple Current Spouse records; numbered previous spouses remain separate | Actual marriage scopes and issues; prior-spouse fields do not satisfy Current Spouse requirements or enter its handoff | `validation.js`; `tests/intake-validation.test.js`, `tests/ssa-canonical-practice.test.mjs` |
| Medication name required; child first/last names are supported repeating fields; children and vehicles optional; unknown record structures warn | Actual nested groups and all fields preserved with source ranges, record identity and validation state | `rules.js`, `validation.js`, `client-data.js`; `tests/intake-nested-records.test.js`, `tests/intake-client-data.test.js` |
| At least one numbered medical problem; exact-text distinct count | Every slot/source retained and existing derived distinct count | `medical-problems.js`, `validation.js`; `tests/intake-audit-fixes.test.js` |
| Letters/spaces and title case for configured names/places; numbers allowed in addresses; phone 10 digits, SSN 9, ZIP 5; email syntax; strict dates/month precision; amount format; unchanged other free text | Existing format output and errors, original source beside it | `formats.js`, `values.js`; `tests/intake-formats.test.js` |
| Duplicate same-subject answers, equivalent formatted strings and conflicts | All occurrences and existing conflict issue, never silently select competing answers | `answers.js`, `validation.js`; `tests/intake-duplicates.test.js` |
| Unrecognized text scoped to section/record; export header treated as metadata; original UTF-16 offsets | Source text/header range, scope IDs, unparsed lines and issue links | `parser.js`, `source-location.js`; `tests/intake-parsing-scope.test.js`, `tests/intake-document-header.test.js`, `tests/intake-source-location.test.js` |
| Currently Working; Receiving income from three explicit receipt flags; Other Names; Separated; More Than 10 Conditions | Existing review items and field dependencies, reviewed state | `review.js`, `review-fields.js`; `tests/intake-review.test.js` |
| Failed Work Attempt only after established onset, full dates and duration <= three calendar months | Existing per-job review plus onset/start/end references; onset/last worked/work stopped remain separate concepts | `review.js`; `tests/intake-review.test.js`, `tests/intake-audit-fixes.test.js` |
| Review display identifier/email and summary counts | Derived display-only metadata; never backfilled into answer fields | `review.js`, `parser.js`; `tests/intake-review.test.js`, `tests/intake-parser.test.js` |
| Ignore/Reviewed UI; corrections preserve original source, recompute existing validation, retain only applicable decisions; recheck resets | Exact existing acknowledgement flags, original/corrected values and edit revisions | `acknowledgements.js`, `session.js`; `tests/intake-acknowledgements.test.js`, `tests/intake-audit-fixes.test.js` |

## Inspection, privacy and compatibility

After checking an intake, open **Inspect structured intake data**. The compact table shows values, state and Find in Intake actions; expandable JSON includes every property. The view regenerates from the active session after corrections and review decisions. Input edits, recheck, Clear, sign-out, pagehide and reload clear/reset the same session as before. Unrecognized-only input is inspectable with `validationPerformed: false`, preserving the existing rule that validation is not run without a recognized section.

No automatic storage, network requests, account preferences, logs, analytics or URL/history payloads are added. Copy JSON explicitly writes to the clipboard; Download JSON explicitly creates a local file named `intake-checker-client-data.json`, through a short-lived Blob URL that is revoked. Both contain sensitive full intake text and results if used with a real intake. They survive page close by employee choice; the on-page explanation makes this explicit. Filenames contain no client identifiers. The snapshot and preview use safe text rendering. No data is sent to a third-party service.

All implementation lives under `intake-checker/`. SSA re-exports the catalog and reads the Checker version; its existing adapter behavior remains covered by compatibility tests. No generic shared schema is introduced. Breaking changes to IDs/types/meaning require a major schema version. Additive metadata or supported fields require a minor schema version; compatible fixes use patch versions. Consumers must reject unknown major schemas and must not interpret unmapped data or derive missing answers.

## What cannot yet be represented with a verified meaning

The observed `Blind or have low vision` source label resolves to the supported `BlindOrHaveLowVision` field, with its original source range retained. Eight observed medical labels are preserved as unsupported fields and do not establish filing answers. Unknown labels are preserved as uninterpreted text, even if they resemble an SSA question. Many optional section headings have no verified field catalog. Arbitrary bold labels and standalone plain labels are accepted; unknown same-line plain labels remain unparsed. HTML/table exports, multiple fields on one line and ambiguous free-text headings follow the existing parser limitations. Prior-marriage duration/details and Total Earnings validation remain deferred. Date work stopped has no supported definition; it is never inferred from onset or last worked. Counts and typed values do not claim complete DeLorean coverage beyond the actual parser. Unrecognized-only input has no validation result. Repeating records lack permanent source IDs, so stable instance identity is limited to unchanged heading/ordinal structure.

## Fixed field inventory

The following rows reconcile every registered definition to its category, source section, exact label, type, and fixed/repeating scope. Rules and tests for each family are listed above. Numbered medical fields use `medical-problems.problem` plus their source slot; arbitrary fields use `unmapped:` plus the exact encoded label and scope.

| Category | Stable definition ID | Source section | Exact label | Type | Scope |
| --- | --- | --- | --- | --- | --- |
| personal | personal.first-name | PERSONAL INFORMATION | First Name | text | Fixed |
| personal | personal.last-name | PERSONAL INFORMATION | Last Name | text | Fixed |
| personal | personal.gender | PERSONAL INFORMATION | Gender | text | Fixed |
| personal | personal.social-security-number | PERSONAL INFORMATION | Social Security Number | text | Fixed |
| personal | personal.phone-number | PERSONAL INFORMATION | Phone Number | text | Fixed |
| personal | personal.email | PERSONAL INFORMATION | Email | text | Fixed |
| personal | personal.middle-name | PERSONAL INFORMATION | Middle Name | text | Fixed |
| personal | personal.suffix | PERSONAL INFORMATION | Suffix | text | Fixed |
| personal | personal.nickname | PERSONAL INFORMATION | Nickname | text | Fixed |
| personal | personal.preferred-contact-method | PERSONAL INFORMATION | Preferred Contact Method | text | Fixed |
| personal | personal.alternate-phone | PERSONAL INFORMATION | Alternate Phone | text | Fixed |
| personal | personal.secondary-phone | PERSONAL INFORMATION | Secondary Phone | text | Fixed |
| birth | birth.date-of-birth | BIRTH INFORMATION | Date of Birth | date | Fixed |
| birth | birth.city-of-birth | BIRTH INFORMATION | City of Birth | text | Fixed |
| birth | birth.state-of-birth | BIRTH INFORMATION | State of Birth | text | Fixed |
| birth | birth.country-of-birth | BIRTH INFORMATION | Country of Birth | text | Fixed |
| address | address.mailing-address-street-address | ADDRESS INFORMATION | Mailing Address - Street Address | text | Fixed |
| address | address.mailing-address-city | ADDRESS INFORMATION | Mailing Address - City | text | Fixed |
| address | address.mailing-address-state | ADDRESS INFORMATION | Mailing Address - State | text | Fixed |
| address | address.mailing-address-zipcode | ADDRESS INFORMATION | Mailing Address - Zipcode | text | Fixed |
| address | address.physical-address-street-address | ADDRESS INFORMATION | Physical Address - Street Address | text | Fixed |
| address | address.physical-address-city | ADDRESS INFORMATION | Physical Address - City | text | Fixed |
| address | address.physical-address-state | ADDRESS INFORMATION | Physical Address - State | text | Fixed |
| address | address.physical-address-zipcode | ADDRESS INFORMATION | Physical Address - Zipcode | text | Fixed |
| address | address.mailing-address-street-address-2 | ADDRESS INFORMATION | Mailing Address - Street Address 2 | text | Fixed |
| address | address.physical-address-street-address-2 | ADDRESS INFORMATION | Physical Address - Street Address 2 | text | Fixed |
| language | language.preferred-language | LANGUAGE INFORMATION | Preferred Language | text | Fixed |
| language | language.can-speak-and-understand-english | LANGUAGE INFORMATION | Can speak and understand English | boolean | Fixed |
| language | language.can-read-simple-english-messages | LANGUAGE INFORMATION | Can read simple English messages | boolean | Fixed |
| language | language.can-write-simple-english-messages | LANGUAGE INFORMATION | Can write simple English messages | boolean | Fixed |
| language | language.can-read-simple-messages-in-preferred-language | LANGUAGE INFORMATION | Can read simple messages in preferred language | boolean | Fixed |
| language | language.can-write-simple-messages-in-preferred-language | LANGUAGE INFORMATION | Can write simple messages in preferred language | boolean | Fixed |
| security-questions | security-questions.mother-first-name | SECURITY QUESTIONS | Mother - First Name | text | Fixed |
| security-questions | security-questions.mother-maiden-name | SECURITY QUESTIONS | Mother - Maiden Name | text | Fixed |
| security-questions | security-questions.father-first-name | SECURITY QUESTIONS | Father - First Name | text | Fixed |
| security-questions | security-questions.father-last-name | SECURITY QUESTIONS | Father - Last Name | text | Fixed |
| security-questions | security-questions.other-legal-representative | SECURITY QUESTIONS | Other Legal Representative | text | Fixed |
| vehicle-summary | vehicle-summary.own-any-vehicles | VEHICLES | Own any vehicles | boolean | Fixed |
| vitals | vitals.height-feet | VITALS | Height (feet) | text | Fixed |
| vitals | vitals.weight-pounds | VITALS | Weight (pounds) | text | Fixed |
| vitals | vitals.height-inches | VITALS | Height (inches) | text | Fixed |
| employment | employment.when-did-you-last-work | EMPLOYMENT INFORMATION | When did you last work | date | Fixed |
| employment | employment.currently-working | EMPLOYMENT INFORMATION | Currently working | boolean | Fixed |
| marriage | marriage.marital-status | MARRIAGE INFORMATION | Marital Status | text | Fixed |
| school | school.school-city | SCHOOL INFORMATION | School City | text | Fixed |
| school | school.school-state | SCHOOL INFORMATION | School State | text | Fixed |
| school | school.school-name-where-highest-grade-completed | SCHOOL INFORMATION | School name where highest grade completed | text | Fixed |
| school | school.highest-grade-completed | SCHOOL INFORMATION | Highest Grade Completed | text | Fixed |
| school | school.country-where-school-located | SCHOOL INFORMATION | Country where school located | text | Fixed |
| school | school.school-address-line-1 | SCHOOL INFORMATION | School Address Line 1 | text | Fixed |
| school | school.school-address-line-2 | SCHOOL INFORMATION | School Address Line 2 | text | Fixed |
| school | school.school-zip-code | SCHOOL INFORMATION | School Zip Code | text | Fixed |
| school | school.school-end-date | SCHOOL INFORMATION | School End Date | date | Fixed |
| school | school.school-phone-number | SCHOOL INFORMATION | School Phone Number | text | Fixed |
| school | school.teacher-name | SCHOOL INFORMATION | Teacher Name | text | Fixed |
| vehicles | vehicles.year | VEHICLES | Year | text | Repeating |
| vehicles | vehicles.make | VEHICLES | Make | text | Repeating |
| vehicles | vehicles.model | VEHICLES | Model | text | Repeating |
| vehicles | vehicles.mileage | VEHICLES | Mileage | text | Repeating |
| providers | providers.phone-number | MEDICAL PROVIDERS | Phone Number | text | Repeating |
| providers | providers.address | MEDICAL PROVIDERS | Address | text | Repeating |
| providers | providers.city | MEDICAL PROVIDERS | City | text | Repeating |
| providers | providers.state | MEDICAL PROVIDERS | State | text | Repeating |
| providers | providers.zipcode | MEDICAL PROVIDERS | Zipcode | text | Repeating |
| providers | providers.clinic-name | MEDICAL PROVIDERS | Clinic Name | text | Repeating |
| providers | providers.doctor-first-name | MEDICAL PROVIDERS | Doctor First Name | text | Repeating |
| providers | providers.doctor-last-name | MEDICAL PROVIDERS | Doctor Last Name | text | Repeating |
| providers | providers.address-2 | MEDICAL PROVIDERS | Address 2 | text | Repeating |
| providers | providers.notes | MEDICAL PROVIDERS | Notes | text | Repeating |
| providers | providers.first-visit-date | MEDICAL PROVIDERS | First Visit Date | date | Repeating |
| providers | providers.next-visit-date | MEDICAL PROVIDERS | Next Visit Date | date | Repeating |
| medications | medications.medication-name | MEDICATIONS | Medication Name | text | Repeating |
| medications | medications.reason-for-taking | MEDICATIONS | Reason for taking | text | Repeating |
| medications | medications.prescriber | MEDICATIONS | Prescriber | text | Repeating |
| jobs | jobs.job-title | WORK HISTORY | Job Title | text | Repeating |
| jobs | jobs.employer | WORK HISTORY | Employer | text | Repeating |
| jobs | jobs.business-type | WORK HISTORY | Business Type | text | Repeating |
| jobs | jobs.start-date | WORK HISTORY | Start Date | date | Repeating |
| jobs | jobs.end-date | WORK HISTORY | End Date | date | Repeating |
| jobs | jobs.hours-per-day | WORK HISTORY | Hours per Day | text | Repeating |
| jobs | jobs.days-per-week | WORK HISTORY | Days per Week | text | Repeating |
| jobs | jobs.rate-of-pay | WORK HISTORY | Rate of Pay | text | Repeating |
| jobs | jobs.pay-frequency | WORK HISTORY | Pay Frequency | text | Repeating |
| jobs | jobs.address | WORK HISTORY | Address | text | Repeating |
| jobs | jobs.city | WORK HISTORY | City | text | Repeating |
| jobs | jobs.state | WORK HISTORY | State | text | Repeating |
| jobs | jobs.zipcode | WORK HISTORY | Zipcode | text | Repeating |
| spouse | spouse.first-name | MARRIAGE INFORMATION | First Name | text | Repeating |
| spouse | spouse.last-name | MARRIAGE INFORMATION | Last Name | text | Repeating |
| spouse | spouse.marriage-date | MARRIAGE INFORMATION | Marriage Date | date | Repeating |
| spouse | spouse.birth-country | MARRIAGE INFORMATION | Birth Country | text | Repeating |
| spouse | spouse.birth-city | MARRIAGE INFORMATION | Birth City | text | Repeating |
| spouse | spouse.birth-state | MARRIAGE INFORMATION | Birth State | text | Repeating |
| spouse | spouse.age | MARRIAGE INFORMATION | Age | text | Repeating |
| spouse | spouse.city-of-marriage | MARRIAGE INFORMATION | City of Marriage | text | Repeating |
| spouse | spouse.state-of-marriage | MARRIAGE INFORMATION | State of Marriage | text | Repeating |
| spouse | spouse.type-of-marriage | MARRIAGE INFORMATION | Type of Marriage | text | Repeating |
| spouse | spouse.maiden-name | MARRIAGE INFORMATION | Maiden Name | text | Repeating |
| spouse | spouse.social-security-number | MARRIAGE INFORMATION | Social Security Number | text | Repeating |
| priorSpouses | priorSpouses.first-name | MARRIAGE INFORMATION | First Name | text | Repeating |
| priorSpouses | priorSpouses.middle-name | MARRIAGE INFORMATION | Middle Name | text | Repeating |
| priorSpouses | priorSpouses.last-name | MARRIAGE INFORMATION | Last Name | text | Repeating |
| priorSpouses | priorSpouses.name-at-birth | MARRIAGE INFORMATION | Name at Birth | text | Repeating |
| priorSpouses | priorSpouses.social-security-number | MARRIAGE INFORMATION | Social Security Number | text | Repeating |
| priorSpouses | priorSpouses.birth-country | MARRIAGE INFORMATION | Birth Country | text | Repeating |
| priorSpouses | priorSpouses.birth-city | MARRIAGE INFORMATION | Birth City | text | Repeating |
| priorSpouses | priorSpouses.birth-state | MARRIAGE INFORMATION | Birth State | text | Repeating |
| priorSpouses | priorSpouses.age | MARRIAGE INFORMATION | Age | text | Repeating |
| priorSpouses | priorSpouses.city-of-marriage | MARRIAGE INFORMATION | City of Marriage | text | Repeating |
| priorSpouses | priorSpouses.state-of-marriage | MARRIAGE INFORMATION | State of Marriage | text | Repeating |
| priorSpouses | priorSpouses.type-of-marriage | MARRIAGE INFORMATION | Type of Marriage | text | Repeating |
| priorSpouses | priorSpouses.marriage-date | MARRIAGE INFORMATION | Marriage Date | date | Repeating |
| priorSpouses | priorSpouses.how-marriage-ended | MARRIAGE INFORMATION | How Marriage Ended | text | Repeating |
| priorSpouses | priorSpouses.marriage-end-date | MARRIAGE INFORMATION | Marriage End Date | date | Repeating |
| priorSpouses | priorSpouses.city-where-marriage-ended | MARRIAGE INFORMATION | City where marriage ended | text | Repeating |
| priorSpouses | priorSpouses.state-where-marriage-ended | MARRIAGE INFORMATION | State where marriage ended | text | Repeating |
| priorSpouses | priorSpouses.prior-spouse-died-since-marriage-ended | MARRIAGE INFORMATION | Prior spouse died since marriage ended | text | Repeating |
| children | children.first-name | CHILDREN INFORMATION | First Name | text | Repeating |
| children | children.last-name | CHILDREN INFORMATION | Last Name | text | Repeating |
| providers | providers.last-visit-date | MEDICAL PROVIDERS | Last Visit Date | date | Repeating |
| employment | employment.have-you-ever-worked | EMPLOYMENT INFORMATION | Have you ever worked | boolean | Fixed |
| other-names | other-names.used-other-names-in-medical-records | OTHER NAMES | Used other names in medical records | boolean | Fixed |
| other-names | other-names.other-first-name | OTHER NAMES | Other first name | text | Fixed |
| other-names | other-names.other-last-name | OTHER NAMES | Other last name | text | Fixed |
| remarks | remarks.remarks-comments | REMARKS/COMMENTS | Remarks/Comments | text | Fixed |
| disability | disability.onset-date-of-disability | DISABILITY INFORMATION | Onset date of disability | date | Fixed |
| medical-information | medical-information.blindorhavelowvision | MEDICAL INFORMATION | BlindOrHaveLowVision | boolean | Fixed |
| financial-support | financial-support.veteran-benefits-receive-veteran-benefits | FINANCIAL SUPPORT | Veteran Benefits - Receive Veteran Benefits | boolean | Fixed |
| financial-support | financial-support.retirement-pension-receive-retirement-pension | FINANCIAL SUPPORT | Retirement/Pension - Receive Retirement/Pension | boolean | Fixed |
| financial-support | financial-support.borrowing-money-borrowing-money | FINANCIAL SUPPORT | Borrowing Money - Borrowing Money | boolean | Fixed |
| financial-support | financial-support.veteran-benefits-monthly-amount | FINANCIAL SUPPORT | Veteran Benefits - Monthly amount | text | Fixed |
| financial-support | financial-support.retirement-pension-monthly-amount | FINANCIAL SUPPORT | Retirement/Pension - Monthly amount | text | Fixed |
| financial-support | financial-support.borrowing-money-monthly-amount | FINANCIAL SUPPORT | Borrowing Money - Monthly amount | text | Fixed |
| financial-support | financial-support.other-support-section-8-housing | FINANCIAL SUPPORT | Other Support - Section 8 Housing | boolean | Fixed |
| financial-support | financial-support.other-support-part-time-work | FINANCIAL SUPPORT | Other Support - Part Time Work | boolean | Fixed |
| financial-support | financial-support.other-support-stay-with-family | FINANCIAL SUPPORT | Other Support - Stay with Family | boolean | Fixed |
| financial-support | financial-support.other-support-stay-with-friends | FINANCIAL SUPPORT | Other Support - Stay with Friends | boolean | Fixed |
| financial-support | financial-support.other-support-other | FINANCIAL SUPPORT | Other Support - Other | boolean | Fixed |

## Counts by category

| Category | Definitions |
| --- | --- |
| personal | 12 |
| birth | 4 |
| address | 10 |
| language | 6 |
| security-questions | 5 |
| vehicle-summary | 1 |
| vitals | 3 |
| employment | 3 |
| marriage | 1 |
| school | 11 |
| vehicles | 4 |
| providers | 13 |
| medications | 3 |
| jobs | 13 |
| spouse | 12 |
| children | 2 |
| other-names | 3 |
| remarks | 1 |
| disability | 1 |
| medical-information | 1 |
| financial-support | 11 |
