# Intake Checker v1.7.0 field and rules audit

Audit date: October 5, 2026. Baseline: main at beae14c5213790e06c807fb9ba0080c978af6a57. Intake footer is v1.7.0 (intake-checker/index.html:56); SSA handoff is v1.2.0; contract is 1.0.0. No SSA development or fixes were performed. Only this summary and the companion CSV are deliverables.

## How Sam can review the CSV

The CSV has the 30 requested columns. Filter Category and Required status. Enter decisions in “Sam’s approved rule”; all approval cells start blank. “Implementation status” reports the existing behavior only. Code paths and one-based line numbers refer to the baseline above. audit.Rxx identifiers are inventory keys, not proposed profile IDs. No fixture values or client records are reproduced here.

## Inventory and reconciliation

- **270 rows**: 119 fixed definition rows + 21 medical-label template rows + 7 unsupported-input examples/fallback rows + 12 prior/generic-marriage context rows + 54 individual derived/metadata rows + 57 rule/control rows.
- The **119 fixed meanings** comprise **72 singleton definitions and 47 record-field templates**, across 20 categories. They reconcile exactly to all 119 IDs and types in intake-contract.js and PROFILE-CONTRACT.md, and **109 distinct fixed plain parser labels**. Reused labels have distinct section meanings.
- **140 supported field-template rows** = 119 fixed definitions + 20 explicit medical word labels + one unbounded positive-integer medical-label family. Numeric labels have no maximum, so there is no finite count of all possible instances. Word and numeric spellings are not merged by code. The seven unsupported rows are examples and a catch-all, not seven new supported definitions.
- **57 distinct rule/control families** R01–R57 are separately inventoried. This counts reusable code rules, not every per-field application or every possible runtime error instance. Six are general review triggers; four additional families concern validation review warnings. Derived name, last-four, identifier, email/copy, summaries, source metadata, session and profile counts also have their own rows.
- Fixed definitions by current requirement: **27 always required, 34 conditional, 58 optional**. Repeating record requirements count as conditional because the record group can be absent. Provider name alternatives each count conditional; no single alternative is always required.
- Entire CSV classification: 28 Always required; 76 Optional; 56 Conditional; 54 Derived/control; 46 Rule/control; 10 Review-only. This includes raw input and rules, and must not be mistaken for a client-answer count.
- 23 discrepancies/ambiguities and 19 missing-test findings are listed below. They are observations for approval, not fixes or declarations of the correct business rule.

### Field counts by category

| Fixed category | Definitions | Record templates |
| --- | ---: | ---: |
| personal | 12 | 0 |
| birth | 4 | 0 |
| address | 10 | 0 |
| language | 6 | 0 |
| security-questions | 5 | 0 |
| vehicle-summary | 1 | 0 |
| vitals | 3 | 0 |
| employment | 3 | 0 |
| marriage | 1 | 0 |
| school | 11 | 0 |
| vehicles | 4 | 4 |
| providers | 13 | 13 |
| medications | 3 | 3 |
| jobs | 13 | 13 |
| spouse | 12 | 12 |
| children | 2 | 2 |
| other-names | 3 | 0 |
| remarks | 1 | 0 |
| disability | 1 | 0 |
| financial-support | 11 | 0 |

Medical problems add 21 inventory rows for one production definition family. Unsupported examples/fallback add seven rows, and prior/generic marriage adds twelve distinct context rows. Derived/metadata members add 54 rows; rule/control rows add 57. CHILDREN INFORMATION has no singleton answer definition; its two names are record templates. All 109 configured plain labels appear in the 119-definition set; arbitrary bold labels and headings make parser inputs open-ended (parser.js:4, :43).

## Always-required fields

Validation runs only if the UI has parsed at least one section. Fully absent/empty required sections produce grouped errors; partial sections produce individual missing errors (validation.js:49; intake-checker.js:48). Raw intake text is a separate required workflow input, not a client-profile field.

- **personal.first-name** — First Name: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:5`, `intake-checker/parser.js:28`).
- **personal.last-name** — Last Name: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:5`, `intake-checker/parser.js:28`).
- **personal.gender** — Gender: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:5`, `intake-checker/parser.js:28`).
- **personal.social-security-number** — Social Security Number: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:5`, `intake-checker/parser.js:28`).
- **personal.phone-number** — Phone Number: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:5`, `intake-checker/parser.js:28`).
- **personal.email** — Email: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:5`, `intake-checker/parser.js:28`).
- **birth.date-of-birth** — Date of Birth: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:8`, `intake-checker/parser.js:28`).
- **birth.city-of-birth** — City of Birth: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:8`, `intake-checker/parser.js:28`).
- **birth.state-of-birth** — State of Birth: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:8`, `intake-checker/parser.js:28`).
- **birth.country-of-birth** — Country of Birth: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:8`, `intake-checker/parser.js:28`).
- **address.mailing-address-street-address** — Mailing Address - Street Address: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:10`, `intake-checker/parser.js:28`).
- **address.mailing-address-city** — Mailing Address - City: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:10`, `intake-checker/parser.js:28`).
- **address.mailing-address-state** — Mailing Address - State: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:10`, `intake-checker/parser.js:28`).
- **address.mailing-address-zipcode** — Mailing Address - Zipcode: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:10`, `intake-checker/parser.js:28`).
- **address.physical-address-street-address** — Physical Address - Street Address: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:10`, `intake-checker/parser.js:28`).
- **address.physical-address-city** — Physical Address - City: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:10`, `intake-checker/parser.js:28`).
- **address.physical-address-state** — Physical Address - State: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:10`, `intake-checker/parser.js:28`).
- **address.physical-address-zipcode** — Physical Address - Zipcode: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:10`, `intake-checker/parser.js:28`).
- **language.preferred-language** — Preferred Language: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:14`, `intake-checker/parser.js:28`).
- **language.can-speak-and-understand-english** — Can speak and understand English: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:14`, `intake-checker/parser.js:28`).
- **language.can-read-simple-english-messages** — Can read simple English messages: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:14`, `intake-checker/parser.js:28`).
- **language.can-write-simple-english-messages** — Can write simple English messages: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:14`, `intake-checker/parser.js:28`).
- **vitals.height-feet** — Height (feet): For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:19`, `intake-checker/parser.js:28`).
- **vitals.weight-pounds** — Weight (pounds): For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:19`, `intake-checker/parser.js:28`).
- **employment.currently-working** — Currently working: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:20`, `intake-checker/parser.js:28`).
- **school.school-city** — School City: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:24`, `intake-checker/parser.js:28`).
- **school.school-state** — School State: For every intake when validation runs (at least one section parsed). A fully absent/empty required section produces one grouped error; otherwise the field has its own missing error. (`intake-checker/rules.js:24`, `intake-checker/parser.js:28`).

## Conditionally required fields

- **employment.when-did-you-last-work** — When did you last work: Required unless the distinct nonmissing Have you ever worked values, trimmed and lowercased, consist solely of no. Currently working does not control this requirement. (`intake-checker/rules.js:20`, `intake-checker/parser.js:28`).
- **providers.phone-number** — Phone Number: For every recognized providers record under MEDICAL PROVIDERS; the entire record group may be absent. (`intake-checker/rules.js:32`, `intake-checker/parser.js:28`).
- **providers.address** — Address: For every recognized providers record under MEDICAL PROVIDERS; the entire record group may be absent. (`intake-checker/rules.js:32`, `intake-checker/parser.js:28`).
- **providers.city** — City: For every recognized providers record under MEDICAL PROVIDERS; the entire record group may be absent. (`intake-checker/rules.js:32`, `intake-checker/parser.js:28`).
- **providers.state** — State: For every recognized providers record under MEDICAL PROVIDERS; the entire record group may be absent. (`intake-checker/rules.js:32`, `intake-checker/parser.js:28`).
- **providers.zipcode** — Zipcode: For every recognized providers record under MEDICAL PROVIDERS; the entire record group may be absent. (`intake-checker/rules.js:32`, `intake-checker/parser.js:28`).
- **providers.clinic-name** — Clinic Name: This is an alternative in the provider-name requirement: at least one nonmissing Clinic Name, Doctor First Name or Doctor Last Name must exist for each recognized provider. No particular one is mandatory. (`intake-checker/rules.js:32`, `intake-checker/parser.js:28`).
- **providers.doctor-first-name** — Doctor First Name: This is an alternative in the provider-name requirement: at least one nonmissing Clinic Name, Doctor First Name or Doctor Last Name must exist for each recognized provider. No particular one is mandatory. (`intake-checker/rules.js:32`, `intake-checker/parser.js:28`).
- **providers.doctor-last-name** — Doctor Last Name: This is an alternative in the provider-name requirement: at least one nonmissing Clinic Name, Doctor First Name or Doctor Last Name must exist for each recognized provider. No particular one is mandatory. (`intake-checker/rules.js:32`, `intake-checker/parser.js:28`).
- **medications.medication-name** — Medication Name: For every recognized medications record under MEDICATIONS; the entire record group may be absent. (`intake-checker/rules.js:37`, `intake-checker/parser.js:28`).
- **jobs.job-title** — Job Title: For every recognized jobs record under WORK HISTORY; the entire record group may be absent. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.employer** — Employer: For every recognized jobs record under WORK HISTORY; the entire record group may be absent. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.business-type** — Business Type: For every recognized jobs record under WORK HISTORY; the entire record group may be absent. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.start-date** — Start Date: For every recognized jobs record under WORK HISTORY; the entire record group may be absent. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.end-date** — End Date: For every recognized jobs record under WORK HISTORY; the entire record group may be absent. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.hours-per-day** — Hours per Day: For every recognized jobs record under WORK HISTORY; the entire record group may be absent. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.days-per-week** — Days per Week: For every recognized jobs record under WORK HISTORY; the entire record group may be absent. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.rate-of-pay** — Rate of Pay: For every recognized jobs record under WORK HISTORY; the entire record group may be absent. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.pay-frequency** — Pay Frequency: For every recognized jobs record under WORK HISTORY; the entire record group may be absent. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.address** — Address: Required for this recognized job only when a single nonmissing, nonconflicting End Date parses successfully and its year equals the employee device local current year. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.city** — City: Required for this recognized job only when a single nonmissing, nonconflicting End Date parses successfully and its year equals the employee device local current year. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.state** — State: Required for this recognized job only when a single nonmissing, nonconflicting End Date parses successfully and its year equals the employee device local current year. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **jobs.zipcode** — Zipcode: Required for this recognized job only when a single nonmissing, nonconflicting End Date parses successfully and its year equals the employee device local current year. (`intake-checker/rules.js:38`, `intake-checker/parser.js:28`).
- **spouse.first-name** — First Name: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **spouse.last-name** — Last Name: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **spouse.marriage-date** — Marriage Date: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **spouse.birth-country** — Birth Country: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **spouse.birth-city** — Birth City: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **spouse.birth-state** — Birth State: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **spouse.age** — Age: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **spouse.city-of-marriage** — City of Marriage: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **spouse.state-of-marriage** — State of Marriage: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **spouse.type-of-marriage** — Type of Marriage: Required in every Current Spouse record only when parent Marital Status resolves exactly to Married (case-sensitive). Also required on any immediate marriage subsection containing any spouse required/optional label, even when its value is blank and status is not Married. (`intake-checker/rules.js:43`, `intake-checker/parser.js:28`).
- **providers.last-visit-date** — Last Visit Date: Required when at least one nonmissing First Visit Date exists in the same provider record, even if first-date values conflict. (`intake-checker/parser.js:13`, `intake-checker/parser.js:28`).

Medical problems are a group condition: at least one nonmissing matching label is required, never every numbered slot (validation.js:152). Missing Current Spouse under exact Married is a record requirement, not fabricated missing spouse answers (validation.js:166; from-intake-checker.js:47).

## Optional fields

- **personal**: Middle Name; Suffix; Nickname; Preferred Contact Method; Alternate Phone; Secondary Phone.
- **address**: Mailing Address - Street Address 2; Physical Address - Street Address 2.
- **language**: Can read simple messages in preferred language; Can write simple messages in preferred language.
- **security-questions**: Mother - First Name; Mother - Maiden Name; Father - First Name; Father - Last Name; Other Legal Representative.
- **vehicle-summary**: Own any vehicles.
- **vitals**: Height (inches).
- **employment**: Have you ever worked.
- **marriage**: Marital Status.
- **school**: Highest Grade Completed; School name where highest grade completed; Country where school located; School Address Line 1; School Address Line 2; School Zip Code; School End Date; School Phone Number; Teacher Name.
- **vehicles**: Year; Make; Model; Mileage.
- **providers**: Address 2; Notes; First Visit Date; Next Visit Date.
- **medications**: Reason for taking; Prescriber.
- **spouse**: Maiden Name; Social Security Number.
- **children**: First Name; Last Name.
- **other-names**: Used other names in medical records; Other first name; Other last name.
- **remarks**: Remarks/Comments.
- **disability**: Onset date of disability.
- **financial-support**: Veteran Benefits - Receive Veteran Benefits; Retirement/Pension - Receive Retirement/Pension; Borrowing Money - Borrowing Money; Veteran Benefits - Monthly amount; Retirement/Pension - Monthly amount; Borrowing Money - Monthly amount; Other Support - Section 8 Housing; Other Support - Part Time Work; Other Support - Stay with Family; Other Support - Stay with Friends; Other Support - Other.

Optional does not mean a present placeholder is ready. Absent optional fields are omitted; present blanks become blocked missing fields. Optional records may still have required fields once recognized. Vehicles have no active record validator. Children have no required name/age fields. Own any vehicles and Have any children do not trigger record requirements. Sources: rules.js:16, :30, :49; validation.js:97; from-intake-checker.js:50.

## Repeating sections and their rules

Six configured record groups contain 47 fixed templates: vehicles 4, providers 13, medications 3, jobs 13, spouse 12, children 2. Medical problems are a seventh repeat family with one definition and the 21 documented label forms/families. There is no fixed maximum number of records.

- Vehicles: Vehicle or Vehicle N heading; Year/Make/Model/Mileage all optional. Own any vehicles does not impose requirements.
- Providers: Clinic, Medical Provider, Provider, Hospital or Doctor, optionally followed by a number; alternatively a descendant with any required provider label. Require phone/address/city/state/ZIP and at least one clinic/doctor name. Date requirements are separate.
- Medications: Medication or Medication N, or a descendant with Medication Name. Require Medication Name only; no dose/frequency validation.
- Jobs: Most Recent Job, Previous Job, Job or Job N, or descendant containing any of nine required labels. Require all nine; address four only for current-local-year End Date. Review uses headings only, not field-based recognition.
- Spouse: Current Spouse heading for adapter mapping and Married requirement. Two such records are ambiguous to adapter. Separate immediate-subsection Type of Marriage rule can apply to prior/generic marriage records, which lack a supported spouse mapping.
- Children: any descendant with First Name or Last Name label, even blank. No guessed heading regex; unknown nonempty leaf warns; empty leaf allowed.
- Medical: root and descendants; exact Problem one through twenty or Problem followed by any positive integer without leading zero. Count populated fields, not distinct diagnoses. Absent group stays a profile requirement.

Sources: rules.js:29; validation.js:82; review.js:45; from-intake-checker.js:102. The adapter and validator differ on descent below a recognized record (D11).

## Normalization rules

Trim outer whitespace; preserve internal text and multiline values. Empty/whitespace or exact Not provided / *Not provided* (case-insensitive) becomes null. Exact label matching is case-sensitive.

Adapter additionally treats N/A, NA, none provided, unknown, standalone not/provided, dashes/question marks, null/undefined/NaN, not applicable/not available, TBD, and Select/Choose prompts as missing. Literal No, false, 0 and None are not globally missing.

Checker and profile normalization are deliberately recorded separately (D04). No case folding of field labels, phone/email/SSN formatting, monetary parsing, address copying, age calculation or numeric coercion exists. Adapter text retains internal whitespace; its cleaning helper collapses whitespace only while checking missing markers. Boolean encoding accepts explicit yes/true/no/false; date encoding uses the calendar helper. Corrections store raw employee input in the ledger and trim the active value. Sources: parser.js:28; validation.js:3; from-intake-checker.js:15; session.js:47.

## Date-order and date-range rules

Profile accepts YYYY-M[-D], M/D/YYYY, M/YYYY, English full/three-letter month plus optional day and four-digit year. Leap/calendar validity and year >=1000 required. Encodes YYYY-MM or YYYY-MM-DD with precision; invalid/unsupported date becomes missing. No general future-date or age restriction.

- Provider Last >= First by month, and by day only if both full-day dates. Same-month with month precision warns. First provided requires Last even when comparison is skipped.
- Next Visit must be this local month or later; an earlier day this month passes.
- End Date current local year triggers job address. Invalid End Date has no new Checker date error and skips that condition.
- Failed Work Attempt: full dates only, End >= Start and strictly before three-month anniversary, UTC arithmetic with month-end clamp. No onset dependency. Equal-day start/end triggers; exact anniversary does not.
- No active DOB age/future limit, marriage chronology, school chronology, onset-versus-last-work rule, or job reversed-date error. Future calendar-valid DOB can therefore become ready; legacy PDF validation differs (D07).

Sources: validation.js:8, :111, :120; review.js:15, :45; from-intake-checker.js:20. See R10–R16/R31 and D02/D06/D07.

## Cross-field dependencies

Exact conditions are in the CSV per field: never-worked no exempts last-work; provider name alternatives; First requires Last; visit chronology; End Date year requires four job-address fields; exact Married requires Current Spouse and ten fields; any immediate marriage detail label requires Type of Marriage; one medical problem minimum; >10 problem fields general review; three income receipt controls combine one flag. No collected monthly amount cross-check, child-count condition, vehicle-ownership condition, currently-working/last-work consistency check or onset-dependent work check exists. Sources: validation.js:74, :111, :116, :152, :157; review.js:33.

## Conflict detection

Checker does not generally flag duplicate labels. Adapter compares trimmed raw candidates in this scope: different strings, including blank versus supplied, block as conflict. Identical duplicates may be ready. Duplicate singleton sections or repeated record roots block as ambiguous. No candidate is selected for a conflict.

Checker single() conflict warnings exist only for three provider dates, job End Date and Marital Status, and ignore missing values. Review uniqueness rejects even identical duplicates. Profile compares raw trimmed strings before typed equivalence and retains all sources; conflict nulls the value. Missing count is based on first candidate encoding (D13). Duplicate repeated root sections block mapped records; medical roots use a different path (D14). Sources: validation.js:59; review.js:10; from-intake-checker.js:56, :97, :102, :113.

## Review-only triggers

Six general flags: More Than 10 Conditions (>10 populated numbered fields), Currently Working (unique Yes/true), Receiving income (any of three unique receipt controls Yes/true), Other Names (unique Yes/true), Separated (unique exact value ignoring case), Failed Work Attempt (R31 dates). No answer is invented and none of these alone blocks profile readiness. Range-less income/problem-count and heading-range work flags remain global decisions.

Four warning families within validation are separate: unrecognized record structure, invalid comparable provider date, same-month imprecise visit order, conflicting dependency-control values. These warnings block mapped fields until acknowledged where they associate with a field. Sources: review.js:20; validation.js:59, :90, :126, :141; from-intake-checker.js:68.

## Dismissal behavior

Checker Reviewed hides the issue without changing the answer. A still-present error remains blocking in the profile even if reviewed. An acknowledged warning stops blocking unless another reason remains. General review flags never establish an answer.

There are **no non-dismissable validation rows in the Checker UI**. There are errors that remain non-overridable for profile readiness despite UI dismissal. All-reviewed is not successful validation. Corrections rerun rules and reconsider related acknowledgements; unrelated identical decisions may survive. Raw input editing, rechecking, Clear and page exit discard decisions. Sources: acknowledgements.js:2, :10; intake-checker.js:84, :98; session.js:23, :54; from-intake-checker.js:68.

## Derived/default values

The inventory includes name, SSN last-four, combined identifier, displayed email/copy status, parser section/client/record summaries (unused by UI), validation counts/success/partial state, source ranges/locations, session revision/edit ledger, profile schema/source metadata, record IDs, typed values/precision, origin/status/reasons, acknowledgement IDs, unassigned requirements, deferred notes and dashboard counts. No client answer or firm standard is defaulted. Local current clock controls year/month conditions; UTC only controls duration arithmetic. Missing optional answers are not created. Every item is covered in R22–R25 and R33–R57 with code references.

## Fields passed to the SSA profile

All 119 meanings in the category table can transfer in correct context. All present medical-problem labels transfer. Every other parsed field transfers through a blocked unsupported fallback. Original candidates, offsets, edits, validation, review decisions, unparsed lines and deferred limitations transfer as metadata. Missing required values are represented only where requirements map to actual field definitions. No extension transport or SSA interaction exists. Sources: intake-contract.js:24; from-intake-checker.js:33, :92, :113, :119, :125.

## Parsed fields not passed to the profile

No individual parsed field is intentionally dropped: the adapter claims known fields then retains unclaimed fields as unsupported. Existing losslessness test asserts total candidate count for its synthetic fixture (from-intake-checker.test.js:176), not every possible nesting case. Values swallowed into a previous multiline answer are not independent parsed fields. Empty headings/tree nodes, raw whole-text blob, unused summarizeIntake output, combined identifier, clipboard status and UI summary states are not profile answer fields. Do not count these as missing client mappings.

## Profile fields without reliable intake sources

Null answers synthesized from required-field errors have no original candidate. Employee-added fields have original null/range null and an edit ledger. Unsupported labels/contexts, duplicate scopes, conflicting candidates, invalid dates, uncertain booleans and unparsed text stay blocked. Positional repeating keys are stable within a session, not person identifiers across intakes. Date work stopped, Total Earnings, prior-marriage duration, citizenship, comprehensive assets, medication doses/frequencies and extra medical/test details lack established mappings. Recognized headings alone do not establish answers (PROFILE-CONTRACT.md:76). Legacy direct-PDF draft profile is a separate schema/workflow and is outside the 119-meaning handoff (PROFILE-CONTRACT.md:3); no attempt was made to expand it.

## Discrepancies and ambiguities

### D01. School requirements contradict README

intake-checker/README.md:31 says school location/contact/teacher required except address lines. intake-checker/README.md:39 and intake-checker/rules.js:22 require only School City/State. tests/intake-validation.test.js:160 agrees with code.

**Sam decision:** Which school rule should documentation describe?

### D02. Failed-work-attempt README describes different logic

intake-checker/README.md:37 says Most Recent Job only, start strictly after onset, end after onset, end on/before anniversary. intake-checker/review.js:45 evaluates every recognized job, ignores onset, allows same-day duration, and excludes exact anniversary. tests/intake-review.test.js:55 and tests/intake-review.test.js:77 agree with code.

**Sam decision:** Approve record scope, onset dependency and boundary before any change.

### D03. Separation TODO is stale

intake-checker/README.md:35 says a confirmed value is needed; intake-checker/review.js:42 implements case-insensitive separated and tests/intake-review.test.js:49 asserts it.

**Sam decision:** Confirm existing trigger or specify exact enum.

### D04. Checker and profile missing markers differ

intake-checker/validation.js:3 recognizes only blank/Not provided; ssa-intake-assistant/src/model/from-intake-checker.js:17 and SSA clean helper recognize additional placeholders. A value may satisfy Checker presence yet be missing in the profile.

**Sam decision:** Confirm whether this split is intended.

### D05. Ready does not imply format-valid or SSA-suitable

ssa-intake-assistant/src/model/from-intake-checker.js:30 passes text; intake-checker/validation.js:46 checks presence and specific rules only. No SSN/email/phone/ZIP/number/enum checks. ssa-intake-assistant/src/model/from-intake-checker.test.js:16 and synthetic generator deliberately transfer generic text for many numeric-looking fields.

**Sam decision:** Document acceptable readiness semantics and any future validation separately.

### D06. Date coverage differs between Checker and adapter

intake-checker/validation.js:111 accepts invalid job End Date without date warning; intake-checker/validation.js:133 skips invalid lone First/Last; DOB/marriage/onset/school dates have no Checker format rule. ssa-intake-assistant/src/model/from-intake-checker.js:20 requires calendar encoding for all date definitions.

**Sam decision:** Approve differing scopes or specify desired rules later.

### D07. Calendar-valid future birth dates can be ready

intake-checker/validation.js:29 has no maximum year or DOB age restriction; ssa-intake-assistant/src/model/from-intake-checker.js:20 therefore allows future DOB. Legacy direct-PDF isImpossibleDate at ssa-intake-assistant/src/model/validation.js:20 has different date/year logic and is not called by this adapter.

**Sam decision:** What DOB range/precision should a future approved rule use?

### D08. Identical duplicates are handled differently

intake-checker/review.js:10 suppresses review for any duplicate; intake-checker/validation.js:59 accepts identical nonmissing duplicates; ssa-intake-assistant/src/model/from-intake-checker.js:59 permits identical candidates in a single unambiguous scope. A duplicated Yes may be ready while Currently Working flag is absent.

**Sam decision:** Should same-value duplicates be treated as unambiguous?

### D09. Marriage-detail condition and duplicate errors

intake-checker/validation.js:162 treats a blank spouse label as details. intake-checker/validation.js:163 and intake-checker/validation.js:171 can report two Type of Marriage errors on one Married spouse. tests/intake-validation.test.js:152 tests populated prior detail, not blank-only/double error.

**Sam decision:** Approve label-presence versus value-presence and duplication behavior.

### D10. Grouped errors overreach in profile mapping

intake-checker/validation.js:74 exempts last-work for no. If Currently working is also missing, intake-checker/validation.js:49 makes grouped error; ssa-intake-assistant/src/model/from-intake-checker.js:52 expands original required list and re-adds last-work, and generic issue attaches to present Have you ever worked too. Synthetic read-only probe reproduced this.

**Sam decision:** Should conditional effective requirements, rather than original list, control expansion?

### D11. Nested record traversal differs

intake-checker/validation.js:88 stops once record recognized; ssa-intake-assistant/src/model/from-intake-checker.js:104 keeps scanning descendants. Nested recognized job/provider may transfer supplied fields ready without Checker required-field checks on that nested record. Synthetic probe reproduced nested job case.

**Sam decision:** Define permitted nesting and consistent record scope.

### D12. Unknown plain label may enter a ready answer

intake-checker/parser.js:77 appends unrecognized plain lines to active value. tests/intake-parser.test.js:55 asserts continuation behavior; ssa-intake-assistant/src/model/from-intake-checker.js:64 sees no unparsed line in this case. Synthetic probe showed combined text ready.

**Sam decision:** Approve multiline handling versus unknown-question detection.

### D13. Conflict and missing counts use different comparisons

ssa-intake-assistant/src/model/from-intake-checker.js:59 compares raw strings, so equivalent boolean/date spellings conflict. ssa-intake-assistant/src/model/from-intake-checker.js:57 uses first encoding for missing; missing+supplied order can change missing count, though both blocked.

**Sam decision:** Define conflict equivalence and order-independent missing semantics.

### D14. Medical review count differs from profile grouping

intake-checker/review.js:34 counts populated fields; ssa-intake-assistant/src/model/from-intake-checker.js:115 groups same label per node and treats word/number spellings separately. ssa-intake-assistant/src/model/from-intake-checker.js:114 does not apply duplicate medical-root ambiguity.

**Sam decision:** Define condition identity and counting across aliases/duplicates/roots.

### D15. School fallback is all-or-nothing

intake-checker/validation.js:70 and ssa-intake-assistant/src/model/from-intake-checker.js:99 ignore parent direct fields once any named School node exists. Existing tests cover fallback alone but not mixed direct and named fields.

**Sam decision:** Define mixed-layout precedence.

### D16. Unused summary helper has narrower/different counts

intake-checker/parser.js:102 omits Provider/un-numbered variants and counts recognized headings under unrelated roots; intake-checker/rules.js:31 and intake-checker/validation.js:99 use different recognition/scoping. Current UI no longer calls summary.

**Sam decision:** Retain as test-only helper or reconcile its documented meaning later?

### D17. Relationship review does not necessarily block both fields

intake-checker/validation.js:140 attaches reversed visit order only to Last; ssa-intake-assistant/src/model/from-intake-checker.js:46 leaves First unaffected. intake-checker/review.js:53 assigns work review to heading; ssa-intake-assistant/src/model/from-intake-checker.js:77 normally cannot overlap individual date ranges. Global decision survives but per-date acknowledgement does not.

**Sam decision:** Confirm conflict scope and future relationship-level metadata needs.

### D18. Conditional control values have inconsistent normalization

intake-checker/validation.js:76 accepts no but not false for never-worked exemption; intake-checker/validation.js:166 requires case-sensitive Married; intake-checker/review.js:43 accepts separated case-insensitively and ssa-intake-assistant/src/model/from-intake-checker.js:27 accepts false as boolean.

**Sam decision:** Approve exact accepted control values.

### D19. Last-four display is not an SSN validity check

intake-checker/review.js:28 takes last four from any >=4 digits. tests/intake-review.test.js:17 checks fewer than four; intermediate/extra-length cases lack direct tests. Full SSN remains in memory/source and profile.

**Sam decision:** Confirm display behavior and wording.

### D20. Blanket memory-only wording omits explicit clipboard action

intake-checker/README.md:3/intake-checker/README.md:27 and ssa-intake-assistant/PROFILE-CONTRACT.md:80 describe memory-only storage. intake-checker/intake-checker.js:141 explicitly writes selected identifier/email to OS clipboard. Tests mock successful/failed copy. Closing page does not clear OS clipboard/history.

**Sam decision:** Clarify employee-copy exception; no automatic client-data transmission was found.

### D21. Received counter includes newly entered answers

ssa-intake-assistant/src/model/intake-contract.js:54 counts sources.length. intake-checker/session.js:46 and ssa-intake-assistant/src/model/from-intake-checker.js:71 create a source entry for added answers, even no original range. ssa-intake-assistant/src/ReadinessDashboard.jsx:26 calls these fields received from active intake.

**Sam decision:** Confirm received wording/count basis.

### D22. README UI and dismissal lifecycle notes are outdated

intake-checker/README.md:51 says Home/nav hide Intake Checker, but shared/settings-storage.js:42 registers it and tests/intake-browser-check.mjs:10 expects it visible. intake-checker/README.md:29 says every edit discards UI state, while intake-checker/session.js:53 retains unrelated dismissals for corrections and intake-checker/README.md:61 distinguishes raw-text editing.

**Sam decision:** Update only after Sam decides desired wording; code is unchanged.

### D23. Generic complete-intake tests are narrow success claims

tests/intake-validation.test.js:213 fills required values with generic No and expects no errors, including date/contact fields. ssa-intake-assistant/src/model/from-intake-checker.test.js:16 tests catalog encoding/transfer, not real-format validation. Tests are consistent with current code but could be misread as proving semantic completeness.

**Sam decision:** Confirm test names/documentation should clarify their limited guarantee.

## Rules present in code but missing tests

“Missing” means no direct branch/edge assertion found in the inspected Checker and adapter tests; it is not a claim of instrumented coverage. Generic catalog/fixture tests do not replace rule-specific assertions. No tests were added.

- **M01 — Medical label regex boundaries.** No exhaustive assertions for all 20 word forms, high numeric indices, zero/leading zero/case variants. Code: intake-checker/rules.js:60. Nearby coverage: tests/intake-validation.test.js:76; tests/intake-review.test.js:26.
- **M02 — Conditional grouped employment mapping.** No direct test for never-worked no with missing Currently working and grouped expansion. Code: intake-checker/validation.js:74; ssa-intake-assistant/src/model/from-intake-checker.js:51. Nearby coverage: tests/intake-validation.test.js:129; ssa-intake-assistant/src/model/from-intake-checker.test.js:145.
- **M03 — Nested recognized record traversal.** Existing recursive unsupported-field test does not assert required rules on a recognized child beneath recognized parent. Code: intake-checker/validation.js:88; ssa-intake-assistant/src/model/from-intake-checker.js:104. Nearby coverage: tests/intake-validation.test.js:43; ssa-intake-assistant/src/model/from-intake-checker.test.js:165.
- **M04 — Each provider-name alternative alone.** Clinic alone and both doctor names are tested; Doctor First alone and Doctor Last alone are not directly asserted. Code: intake-checker/validation.js:117. Nearby coverage: tests/intake-validation.test.js:100.
- **M05 — single() duplicate warning and dependent skip.** No direct Checker assertions for conflicting provider dates, job End Date, Marital Status and missing+supplied/identical duplicate combinations. Adapter conflict tests do not cover the validator helper. Code: intake-checker/validation.js:59. Nearby coverage: tests/intake-validation.test.js:82; tests/intake-validation.test.js:118; ssa-intake-assistant/src/model/from-intake-checker.test.js:73.
- **M06 — Calendar bounds and full accepted formats.** No explicit 999/1000 bound, far-future DOB readiness or exhaustive English/month/day-format boundary matrix. Code: intake-checker/validation.js:13. Nearby coverage: tests/intake-validation.test.js:112; ssa-intake-assistant/src/model/from-intake-checker.test.js:62.
- **M07 — Invalid lone visit dates.** Last-only valid and First-only valid are covered; lone invalid values and differing Checker/profile results are not. Code: intake-checker/validation.js:133. Nearby coverage: tests/intake-validation.test.js:82.
- **M08 — Marriage case/detail/duplicate branches.** No direct assertions for lowercase married, blank-only detail label, duplicate Type of Marriage errors, or identical status duplicates. Code: intake-checker/validation.js:160. Nearby coverage: tests/intake-validation.test.js:145; tests/intake-review.test.js:49.
- **M09 — Medical aliases/duplicates/multiple roots.** Count boundary covered; condition identity, word+number aliases, duplicate candidates and multiple/nested roots not directly asserted. Code: intake-checker/review.js:33; ssa-intake-assistant/src/model/from-intake-checker.js:113. Nearby coverage: tests/intake-review.test.js:26; ssa-intake-assistant/src/model/from-intake-checker.test.js:16.
- **M10 — All configured period-restricted name fields.** Six positive fields sampled. Missing direct positive tests for personal Middle/Last/Suffix/Nickname, four parent names, Other first name, spouse Last/Maiden, child Last, and Teacher Name. Code: intake-checker/validation.js:174. Nearby coverage: tests/intake-validation.test.js:175.
- **M11 — SSN display digit-count boundaries.** Tests cover nine digits/leading-zero last-four and <4; not 4–8 or >9 digits. Code: intake-checker/review.js:28. Nearby coverage: tests/intake-review.test.js:11; tests/intake-review.test.js:17.
- **M12 — Identical duplicate review controls.** Conflicting duplicates tested; identical yes duplicates suppressing review while profile ready is not directly tested. Code: intake-checker/review.js:10; ssa-intake-assistant/src/model/from-intake-checker.js:59. Nearby coverage: tests/intake-review.test.js:44; ssa-intake-assistant/src/model/from-intake-checker.test.js:73.
- **M13 — Rejected correction target cases.** No direct matrix for invalid node path/non-string value/duplicate matches/existing-section refusal or known identical duplicates with no correction target. Code: intake-checker/session.js:34; ssa-intake-assistant/src/model/from-intake-checker.js:79. Nearby coverage: ssa-intake-assistant/src/model/from-intake-checker.test.js:73; ssa-intake-assistant/src/model/from-intake-checker.test.js:125; ssa-intake-assistant/src/model/from-intake-checker.test.js:145.
- **M14 — Dependent acknowledgement reset branches.** Unrelated general dismissal persistence covered; same-node validation reset, scoped review reset and no-range income/medical count resets not directly asserted as a matrix. Code: intake-checker/session.js:54. Nearby coverage: ssa-intake-assistant/src/model/from-intake-checker.test.js:125.
- **M15 — Conflict equivalence and candidate-order counts.** Different name candidates covered; boolean/date equivalent spellings and reversing blank/supplied candidates are not directly asserted. Code: ssa-intake-assistant/src/model/from-intake-checker.js:56. Nearby coverage: ssa-intake-assistant/src/model/from-intake-checker.test.js:73.
- **M16 — Job-heading acknowledgement field association.** Review range and direct working-field acknowledgement covered separately; job heading acknowledgement not tested against date-field metadata. Code: ssa-intake-assistant/src/model/from-intake-checker.js:77. Nearby coverage: tests/intake-review.test.js:77; ssa-intake-assistant/src/model/from-intake-checker.test.js:103.
- **M17 — Mixed direct/nested School layout.** Separate fallback and nested layouts tested; mixed parent fields plus named School node precedence not directly asserted. Code: intake-checker/validation.js:69; ssa-intake-assistant/src/model/from-intake-checker.js:99. Nearby coverage: tests/intake-validation.test.js:160; ssa-intake-assistant/src/model/from-intake-checker.test.js:199.
- **M18 — Prior/generic-marriage labels beyond sampled First Name.** Type requirement is tested through First Name; other configured labels, blank-only alternatives and unsupported profile treatment across all twelve labels lack a dedicated matrix. Code: intake-checker/validation.js:160; ssa-intake-assistant/src/model/from-intake-checker.js:104. Nearby coverage: tests/intake-validation.test.js:152.
- **M19 — Received count after adding absent answer.** Absent-section correction is tested, but its effect on received versus missing-required display counts is not directly asserted. Code: ssa-intake-assistant/src/model/intake-contract.js:54; intake-checker/session.js:46; ssa-intake-assistant/src/model/from-intake-checker.js:71. Nearby coverage: ssa-intake-assistant/src/model/from-intake-checker.test.js:145.

## Tests that appear inconsistent with current code

No failing assertion or direct expected-output contradiction was found in the six executed unit-test files. **115 tests passed, zero failed/skipped.** The test suite agrees with current failed-work-attempt, school and optional-field behavior where README disagrees. D23 identifies overly broad test names/success interpretations, not a failing test. Catalog-driven fixtures share the same definitions as the adapter, so their passing field-count assertion alone is not independent proof of complete intake coverage.

Executed read-only command:

```powershell
node --test --test-isolation=none tests/intake-parser.test.js tests/intake-validation.test.js tests/intake-review.test.js tests/intake-source-location.test.js tests/intake-acknowledgements.test.js ssa-intake-assistant/src/model/from-intake-checker.test.js
```

The bundled Node executable was used. Browser scripts were inspected for rendering, dismissal, clipboard, Back/reset and storage/network assertions; they were not rerun. This audit did not build, start a browser, take screenshots, run OCR, or run the full Toolkit release suite. Read-only synthetic probes reproduced D07/D08/D09/D10/D11/D12/D13/D06 without adding repository tests or logging client values.

## Duplicate or contradictory rules

Prioritize D01–D03 (documentation disagreements), D04/D06/D07 (different normalization/date scopes), D08/D13 (duplicate comparisons), D09 (duplicate marriage errors), D10 (conditional expansion), D11/D15 (scope traversal), D14/D16 (different counting), D17/D18 (relationship/control semantics). No source was chosen as the approved business rule. The CSV preserves actual code behavior and references the conflicting evidence.

## Questions requiring Sam’s decision

Each D01–D23 item above has a decision prompt, and each field row has a Sam decision column. Start with requirement semantics (employment, provider names/dates, spouse, school), then ready-versus-format-valid semantics, then duplicate/record identity and dismissal scope. Review the CSV before authorizing fixes or further SSA development. Sam’s approved-rule cells remain empty.

## Privacy and completion checks

- Audit uses source/rule metadata and clearly synthetic probes only. No real client data, fixture values, screenshots or PDF content are included in either document.
- Application source shows no automatic intake/profile storage or transmission. Auth/session/preference calls are separate; explicit identifier/email copying writes to OS clipboard (D20), which is outside page memory and is not cleared by page exit.
- CSV is UTF-8 with BOM, 30 quoted columns, doubled internal quotes and CRLF records. Literal cells are checked in the spreadsheet engine and re-imported for exact round-trip comparison; Python CSV parsing independently checks dimensions. Formatting is intentionally absent because the requested deliverable is CSV, not XLSX.
- All 119 definition IDs, 109 plain labels and record-category counts were reconciled programmatically against current modules. Every rule row has code/test citations; cited file/line references were checked for existence. This does not claim missing-test branches passed a regression assertion.
- Only the two requested audit documents are created. No application, rule, test, version or dependency files are changed; no commit or push. git diff --check is run on both documents, including no-index checks because new files are untracked.
