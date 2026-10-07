# Intake client-profile contract 3.0.0

This is the in-memory `packard.intake-client-profile` contract consumed by the Intake Checker handoff in SSA Intake Assistant v1.3.0. Its version is independent of both tool versions and of the legacy direct-PDF Phase 1 profile. The direct-PDF route retains its existing local review workflow; it is not automatically eligible for the future extension.

## Audit and coverage

The audit covers `intake-checker/parser.js`, `rules.js`, `validation.js`, `review.js`, `review-fields.js`, `source-location.js`, and `acknowledgements.js`. The parser recognizes 109 distinct fixed plain labels. Their section/record-specific meanings produce 119 field definitions across 20 categories, plus the unbounded numbered medical-problem family. The full catalog below is the contract snapshot; tests compare the implementation against the existing parser configuration and exercise every definition.

The parser also accepts arbitrary bold field labels and headings, including nested records. Every parsed field is retained in the profile. Unknown labels, labels in unsupported contexts, and unknown record meanings receive an opaque `unsupported` ID and remain blocked. A recognized heading alone does not establish answers. No parser labels or parsing rules were added for this release.

Present source fields are included even when blank. Missing required fields reported by the existing validator are represented with null values. Optional fields absent from the source and hypothetical repeated records are not invented. Section/record requirements that cannot be assigned to a particular field remain in `requirements`. Unparsed lines and deferred validator limitations remain in the profile. Consequently an intake's field count varies; 119 is the number of fixed definitions, not a promised count of answers in every intake.

## Structure

```text
{
  schema: "packard.intake-client-profile",
  schemaVersion: "3.0.0",
  revision: integer,
  source: { kind: "intake-checker", toolVersion: "1.8.0" },
  fields: [{
    id, definitionId, recordId, category, label,
    dataType: "text" | "boolean" | "date",
    value: string | boolean | null,
    precision: "day" | "month" | null,
    sources: [{ section, record, nodePath, label, range, rawValue }],
    origin: "parsed" | "absent" | "employee_entered",
    validation: { status: "no_issues" | "unresolved" | "acknowledged", issues },
    employeeReview: {
      status: "not_reviewed" | "acknowledged" | "employee_entered",
      acknowledgements: [decisionId], edits: [{ revision, value }]
    },
    readiness: "ready" | "blocked",
    blockingReasons: [{ code, message, issueId? }],
    correctionTarget: { nodePath, section, label, range } | null
  }],
  validationIssues: [{ ...originalIssue, id, acknowledged }],
  reviewDecisions: [{ ...originalReviewItem, id, acknowledged, kind: "general-review" }],
  requirements: [unassignedValidationIssue],
  unparsed: [{ line, text }],
  deferred: [existingValidatorLimitation]
}
```

`text` uses Checker-owned format results for scoped names, places, addresses, phone numbers, SSNs, ZIPs, emails and amounts. The original parsed candidate remains in sources.rawValue; normalization does not manufacture an employee edit or confirmation. Unknown/free-text answers are unchanged. The Checker, not the adapter, validates formats. Contract 3.0.0 changes readiness semantics from a global unparsed-text block to scoped parsing requirements. Versions 1.0.0 and 2.0.0 are no longer accepted by readyFields(). Normalized value encoding is unchanged from 2.0.0. `boolean` accepts only explicit Yes/No/true/false; qualified or uncertain answers are blocked. `date` uses Intake Checker's existing `parseCalendarDate`: day precision becomes YYYY-MM-DD, month precision becomes YYYY-MM. No missing day is invented. Unsupported or impossible calendar dates become missing, retaining the raw source. Type encoding is not a second business validator.

`range` is a nullable `{start, end}` pair of UTF-16 offsets into the original pasted text (including CRLF). Repeated candidates keep their own source ranges and raw values. Corrections keep original provenance, including original nulls, and append employee-entered values in the edit ledger. An answer added where no source exists has a null range. Profile objects contain plain data; the owning Checker session's mutable state and edit Map are not an extension payload.

## Readiness and review

- Ready: a known direct meaning in an unambiguous scope, an established typed value, no remaining applicable validation problem, and no conflict. Employee-entered corrections become ready under the same conditions. No confirmation checkbox is required or fabricated.
- Missing: blank, Not provided, N/A/NA, unknown, none provided, Not applicable/Not available, placeholder dashes/question marks, null/undefined/NaN, TBD, Select/Choose prompts, or invalid calendar dates. Raw source remains available. `No`, `false`, `0`, and a literal `None` are not globally replaced by guesses.
- Conflict: candidates differing after Intake Checker format normalization for one field, including missing versus supplied. Identical/format-equivalent duplicates combine with all original sources preserved. The value is null; all candidates remain available. Resolve conflicts in the source.
- Ambiguous: unknown mapping/context, duplicate singleton sections, duplicate Current Spouse records, uncertain boolean meaning, or unparsed source text. Unparsed text inside a recognized node blocks fields in that node and its descendants, not unrelated sections or sibling records. Unscoped text remains an unresolved profile requirement without invalidating established answers. Parsing issues carry code, line, scopePath, scopeTitle and source ranges; dismissal and editing an answer cannot bypass source correction. Repeated providers/jobs/children have separate record identities rather than merged answers.
- Validation: apply the existing validator's exact section, record and field scope. Unacknowledged field warnings and all still-present errors block. Dismissing an error does not repair it. Acknowledged warnings retain their metadata; they do not change values or precision.
- General review items (Currently Working, Receiving income, Other Names, Separated, more than 10 conditions, failed work attempts) retain their reviewed/dismissed state but do not themselves invalidate established answers. Scoped acknowledgement IDs are recorded on fields; unscoped decisions remain at profile level.

Missing/conflict counts are subsets of blocked fields. Missing required-section/record requirements remain visible separately. Readiness of some or all received fields does not claim that a whole SSA application is complete.

## Corrections and source ownership

The dashboard permits corrections only for a known unambiguous target. It calls `correctIntakeField` in Intake Checker, which updates the existing parsed node, records the edit, and reruns the existing validator and review functions. It does not parse the intake again or implement a second validator. Related acknowledgements are reconsidered; unrelated unchanged dismissals are retained. The Checker view shows the correction ledger and updated validation/client summary. The pasted text remains the original provenance; editing or rechecking it starts a new session and discards prior overrides. Back/Continue retains the same session and its overrides.

## Stable IDs and future consumers

Singleton IDs equal their catalog definition IDs, such as `personal.first-name`. Repeating IDs append `@` and a session record key, such as `providers.phone-number@providers-2`. Medical problems use `medical-problems.problem@problem-1`. Record keys follow the source order within their category, remain stable across Back, and must not be treated as cross-intake person IDs or inferred chronological rank. Medical exact-text duplicates share the first occurrence's key and retain every source; corrections can merge or split those groups while other original medical occurrence keys remain unchanged. Unsupported IDs use source node/field positions and are never fillable.

A future mapping must reference an exact `definitionId`, select the intended `recordId`, verify a supported schema version, and consume only `readiness: ready` fields with no blocking reasons and non-null values. The local `readyFields()` projection accepts only schema 3.0.0. A mapping must also check the SSA question's actual meaning, required precision and accepted representation. A month-only answer cannot satisfy a full-date question. Unsupported, absent, ambiguous, or differently worded questions must pause for an employee; no fallback to a similarly named answer is allowed.

Disability onset (`disability.onset-date-of-disability`), last worked (`employment.when-did-you-last-work`), and individual job start/end dates are independent. There is no established date-work-stopped definition. It is never derived from onset, last worked, or a job end date. Alternate Phone and Secondary Phone also remain distinct source answers until a future mapping establishes equivalence.

Contract versioning uses semantic versions: changing IDs, types, readiness meaning or record identity is a major change; additive documented definitions/metadata require a minor change; compatible corrections use a patch. Tool versions do not authorize accepting a different contract. Catalog snapshot changes must accompany an explicit contract-version decision. No extension transport, extension authentication, SSA page access or filling is implemented here. Credentials, MFA, CAPTCHA, attestations, signatures and final submission are never automated.

## Not currently established by Intake Checker

Exact mappings are absent for date work stopped, total earnings, prior-marriage duration rules, comprehensive SSI/financial assets, citizenship questions, medical test/hospital details beyond the provider records, medication doses/frequencies, and arbitrary fields within firm-only, specialized-training, special-education, wages, workers' compensation and additional-employment sections. Those headings may be recognized without establishing field meanings. Unknown bold fields are retained but blocked; standalone plain labels ending in a colon within recognized sections are preserved with following answers as unsupported fields. Unknown same-line plain colon questions remain unparsed. Ordinary multiline continuation text remains unchanged. No new question mappings are added.

## Privacy

The parsed intake, format-result Map, complete profile, raw candidates, employee edits, and decisions exist only in the current page's memory/DOM. Explicit Checker copy buttons write selected identifier/email text to the OS clipboard; closing the page does not clear that clipboard. No client data goes into browser storage, preferences, URLs/history, databases, logs, analytics, network requests, or the extension. Toolkit authentication and preferences retain their existing separate behavior. Clear, pagehide/reload/close and account changes discard the active session. Tests use generated synthetic fixtures only.

## Fixed field catalog

The table below is checked by the contract tests. Category-specific duplicate labels have different IDs.

<!-- catalog -->

| Stable definition ID | Source section | Label | Type |
| --- | --- | --- | --- |
| personal.first-name | PERSONAL INFORMATION | First Name | text |
| personal.last-name | PERSONAL INFORMATION | Last Name | text |
| personal.gender | PERSONAL INFORMATION | Gender | text |
| personal.social-security-number | PERSONAL INFORMATION | Social Security Number | text |
| personal.phone-number | PERSONAL INFORMATION | Phone Number | text |
| personal.email | PERSONAL INFORMATION | Email | text |
| personal.middle-name | PERSONAL INFORMATION | Middle Name | text |
| personal.suffix | PERSONAL INFORMATION | Suffix | text |
| personal.nickname | PERSONAL INFORMATION | Nickname | text |
| personal.preferred-contact-method | PERSONAL INFORMATION | Preferred Contact Method | text |
| personal.alternate-phone | PERSONAL INFORMATION | Alternate Phone | text |
| personal.secondary-phone | PERSONAL INFORMATION | Secondary Phone | text |
| birth.date-of-birth | BIRTH INFORMATION | Date of Birth | date |
| birth.city-of-birth | BIRTH INFORMATION | City of Birth | text |
| birth.state-of-birth | BIRTH INFORMATION | State of Birth | text |
| birth.country-of-birth | BIRTH INFORMATION | Country of Birth | text |
| address.mailing-address-street-address | ADDRESS INFORMATION | Mailing Address - Street Address | text |
| address.mailing-address-city | ADDRESS INFORMATION | Mailing Address - City | text |
| address.mailing-address-state | ADDRESS INFORMATION | Mailing Address - State | text |
| address.mailing-address-zipcode | ADDRESS INFORMATION | Mailing Address - Zipcode | text |
| address.physical-address-street-address | ADDRESS INFORMATION | Physical Address - Street Address | text |
| address.physical-address-city | ADDRESS INFORMATION | Physical Address - City | text |
| address.physical-address-state | ADDRESS INFORMATION | Physical Address - State | text |
| address.physical-address-zipcode | ADDRESS INFORMATION | Physical Address - Zipcode | text |
| address.mailing-address-street-address-2 | ADDRESS INFORMATION | Mailing Address - Street Address 2 | text |
| address.physical-address-street-address-2 | ADDRESS INFORMATION | Physical Address - Street Address 2 | text |
| language.preferred-language | LANGUAGE INFORMATION | Preferred Language | text |
| language.can-speak-and-understand-english | LANGUAGE INFORMATION | Can speak and understand English | boolean |
| language.can-read-simple-english-messages | LANGUAGE INFORMATION | Can read simple English messages | boolean |
| language.can-write-simple-english-messages | LANGUAGE INFORMATION | Can write simple English messages | boolean |
| language.can-read-simple-messages-in-preferred-language | LANGUAGE INFORMATION | Can read simple messages in preferred language | boolean |
| language.can-write-simple-messages-in-preferred-language | LANGUAGE INFORMATION | Can write simple messages in preferred language | boolean |
| security-questions.mother-first-name | SECURITY QUESTIONS | Mother - First Name | text |
| security-questions.mother-maiden-name | SECURITY QUESTIONS | Mother - Maiden Name | text |
| security-questions.father-first-name | SECURITY QUESTIONS | Father - First Name | text |
| security-questions.father-last-name | SECURITY QUESTIONS | Father - Last Name | text |
| security-questions.other-legal-representative | SECURITY QUESTIONS | Other Legal Representative | text |
| vehicle-summary.own-any-vehicles | VEHICLES | Own any vehicles | boolean |
| vitals.height-feet | VITALS | Height (feet) | text |
| vitals.weight-pounds | VITALS | Weight (pounds) | text |
| vitals.height-inches | VITALS | Height (inches) | text |
| employment.when-did-you-last-work | EMPLOYMENT INFORMATION | When did you last work | date |
| employment.currently-working | EMPLOYMENT INFORMATION | Currently working | boolean |
| marriage.marital-status | MARRIAGE INFORMATION | Marital Status | text |
| school.school-city | SCHOOL INFORMATION | School City | text |
| school.school-state | SCHOOL INFORMATION | School State | text |
| school.school-name-where-highest-grade-completed | SCHOOL INFORMATION | School name where highest grade completed | text |
| school.highest-grade-completed | SCHOOL INFORMATION | Highest Grade Completed | text |
| school.country-where-school-located | SCHOOL INFORMATION | Country where school located | text |
| school.school-address-line-1 | SCHOOL INFORMATION | School Address Line 1 | text |
| school.school-address-line-2 | SCHOOL INFORMATION | School Address Line 2 | text |
| school.school-zip-code | SCHOOL INFORMATION | School Zip Code | text |
| school.school-end-date | SCHOOL INFORMATION | School End Date | date |
| school.school-phone-number | SCHOOL INFORMATION | School Phone Number | text |
| school.teacher-name | SCHOOL INFORMATION | Teacher Name | text |
| vehicles.year | VEHICLES / record | Year | text |
| vehicles.make | VEHICLES / record | Make | text |
| vehicles.model | VEHICLES / record | Model | text |
| vehicles.mileage | VEHICLES / record | Mileage | text |
| providers.phone-number | MEDICAL PROVIDERS / record | Phone Number | text |
| providers.address | MEDICAL PROVIDERS / record | Address | text |
| providers.city | MEDICAL PROVIDERS / record | City | text |
| providers.state | MEDICAL PROVIDERS / record | State | text |
| providers.zipcode | MEDICAL PROVIDERS / record | Zipcode | text |
| providers.clinic-name | MEDICAL PROVIDERS / record | Clinic Name | text |
| providers.doctor-first-name | MEDICAL PROVIDERS / record | Doctor First Name | text |
| providers.doctor-last-name | MEDICAL PROVIDERS / record | Doctor Last Name | text |
| providers.address-2 | MEDICAL PROVIDERS / record | Address 2 | text |
| providers.notes | MEDICAL PROVIDERS / record | Notes | text |
| providers.first-visit-date | MEDICAL PROVIDERS / record | First Visit Date | date |
| providers.next-visit-date | MEDICAL PROVIDERS / record | Next Visit Date | date |
| medications.medication-name | MEDICATIONS / record | Medication Name | text |
| medications.reason-for-taking | MEDICATIONS / record | Reason for taking | text |
| medications.prescriber | MEDICATIONS / record | Prescriber | text |
| jobs.job-title | WORK HISTORY / record | Job Title | text |
| jobs.employer | WORK HISTORY / record | Employer | text |
| jobs.business-type | WORK HISTORY / record | Business Type | text |
| jobs.start-date | WORK HISTORY / record | Start Date | date |
| jobs.end-date | WORK HISTORY / record | End Date | date |
| jobs.hours-per-day | WORK HISTORY / record | Hours per Day | text |
| jobs.days-per-week | WORK HISTORY / record | Days per Week | text |
| jobs.rate-of-pay | WORK HISTORY / record | Rate of Pay | text |
| jobs.pay-frequency | WORK HISTORY / record | Pay Frequency | text |
| jobs.address | WORK HISTORY / record | Address | text |
| jobs.city | WORK HISTORY / record | City | text |
| jobs.state | WORK HISTORY / record | State | text |
| jobs.zipcode | WORK HISTORY / record | Zipcode | text |
| spouse.first-name | MARRIAGE INFORMATION / record | First Name | text |
| spouse.last-name | MARRIAGE INFORMATION / record | Last Name | text |
| spouse.marriage-date | MARRIAGE INFORMATION / record | Marriage Date | date |
| spouse.birth-country | MARRIAGE INFORMATION / record | Birth Country | text |
| spouse.birth-city | MARRIAGE INFORMATION / record | Birth City | text |
| spouse.birth-state | MARRIAGE INFORMATION / record | Birth State | text |
| spouse.age | MARRIAGE INFORMATION / record | Age | text |
| spouse.city-of-marriage | MARRIAGE INFORMATION / record | City of Marriage | text |
| spouse.state-of-marriage | MARRIAGE INFORMATION / record | State of Marriage | text |
| spouse.type-of-marriage | MARRIAGE INFORMATION / record | Type of Marriage | text |
| spouse.maiden-name | MARRIAGE INFORMATION / record | Maiden Name | text |
| spouse.social-security-number | MARRIAGE INFORMATION / record | Social Security Number | text |
| children.first-name | CHILDREN INFORMATION / record | First Name | text |
| children.last-name | CHILDREN INFORMATION / record | Last Name | text |
| providers.last-visit-date | MEDICAL PROVIDERS / record | Last Visit Date | date |
| employment.have-you-ever-worked | EMPLOYMENT INFORMATION | Have you ever worked | boolean |
| other-names.used-other-names-in-medical-records | OTHER NAMES | Used other names in medical records | boolean |
| other-names.other-first-name | OTHER NAMES | Other first name | text |
| other-names.other-last-name | OTHER NAMES | Other last name | text |
| remarks.remarks-comments | REMARKS/COMMENTS | Remarks/Comments | text |
| disability.onset-date-of-disability | DISABILITY INFORMATION | Onset date of disability | date |
| financial-support.veteran-benefits-receive-veteran-benefits | FINANCIAL SUPPORT | Veteran Benefits - Receive Veteran Benefits | boolean |
| financial-support.retirement-pension-receive-retirement-pension | FINANCIAL SUPPORT | Retirement/Pension - Receive Retirement/Pension | boolean |
| financial-support.borrowing-money-borrowing-money | FINANCIAL SUPPORT | Borrowing Money - Borrowing Money | boolean |
| financial-support.veteran-benefits-monthly-amount | FINANCIAL SUPPORT | Veteran Benefits - Monthly amount | text |
| financial-support.retirement-pension-monthly-amount | FINANCIAL SUPPORT | Retirement/Pension - Monthly amount | text |
| financial-support.borrowing-money-monthly-amount | FINANCIAL SUPPORT | Borrowing Money - Monthly amount | text |
| financial-support.other-support-section-8-housing | FINANCIAL SUPPORT | Other Support - Section 8 Housing | boolean |
| financial-support.other-support-part-time-work | FINANCIAL SUPPORT | Other Support - Part Time Work | boolean |
| financial-support.other-support-stay-with-family | FINANCIAL SUPPORT | Other Support - Stay with Family | boolean |
| financial-support.other-support-stay-with-friends | FINANCIAL SUPPORT | Other Support - Stay with Friends | boolean |
| financial-support.other-support-other | FINANCIAL SUPPORT | Other Support - Other | boolean |

## Chrome synthetic practice consumer

SSA v1.14.0 projects fifteen exact practice mappings from the Intake Checker-owned canonical data into this narrow contract for the Chrome practice extension 0.4.0. The hosted and local pilot both require the employee to affirm that the active intake is fictional before sending. This declaration is not a technical check for real client data; do not use client information in the pilot. Contract 3.0.0 and readyFields semantics are unchanged. The transfer excludes source text, provenance, review metadata and authentication. It requires source approval, receiver arming, a bound session/nonce and a short lease. The extension has no live SSA connection. See extension-dev/README.md for the current mappings, protocol, lifecycle, trust boundary and test instructions.
