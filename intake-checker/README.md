# Intake Checker

Part of the Toolkit's existing Vite build. No intake data is automatically sent, logged, or persisted; Clear and leaving the page remove the current input/results. Deliberate identifier/email copying writes to the OS clipboard, which may remain after page close.

`parseIntake(text)` returns `{ sections, unparsed }`. Sections and subsections have an exact `title`, ordered `fields: [{ label, value }]`, and `subsections`. Arrays intentionally preserve repeated labels and identically named records. `unparsed` retains unmatched text with source line numbers; it drives parsing completeness handling. There is no user-facing JSON/debug view.

Supported format:

- Plain section headings and exact field labels reuse the centralized rules plus known conditional labels. Both `Label: value` and `Label:` followed by value lines are supported.
- Known plain record headings (Clinic 1, Medication 1, Most Recent Job, Current Spouse, etc.) start separate records. Arbitrary uppercase text and unknown colon labels are not promoted to structure.

- Standalone `**SECTION**` or Markdown headings levels 1–3 start main sections.
- Headings levels 4–6 start subsections; heading depth determines nesting. Names need not contain numbers.
- `**Label:**value` and `**Label**:value` start fields. Subsequent lines belong to that value until the next recognized field or heading.
- Empty/whitespace values and `Not provided` (with or without asterisks) become `null`. Other values remain text.

Summary counts identify numbered Clinic, Hospital, Doctor, Medical Provider, Medication, and Job headings, plus Most Recent Job and Previous Job. Unknown categories are omitted rather than reported as zero. Counts are records, not deduplicated people. Client names use unambiguous First Name/Last Name fields under PERSONAL INFORMATION.

Limitations: unknown same-line plain questions/headings, tables, HTML, and multiple fields on the same line are not mapped. Standalone plain question labels inside a section are retained as unsupported fields. A standalone bold line within a free-text answer is interpreted as a section; other unmarked continuation text is treated as part of the previous value. Answers exactly matching known headings or labels can be ambiguous; review the pasted source text.

## Intake Checker v1.5 validation

Flow: `parser.js` → structured intake → independent `review.js` and `validation.js` → UI. The UI skips both systems when no sections are recognized, showing a parsing review message. `rules.js` centralizes exact required/optional labels, record recognition, exact person-name fields, and deferred rules. `validateIntake(intake, rules, { now })` returns structured issues with section, record when applicable, field, severity, reason, and a record location. The default clock is the user's local date; tests inject a fixed date. Developer-only deferred-rule notes are not displayed in the report.

## Review

`reviewIntake(parsed)` returns a masked identifier, email, and review items with parser source ranges. It does not mutate parsed data or validation results. The plain-text parser recognizes the exact optional labels in `review-fields.js`, supplied with the release request, without adding required fields. Review uses native keyboard-accessible buttons styled as plain text and the Clipboard API; copy failures are reported without replacing the displayed value. The identifier joins the name and last four with a space. Review flags use the Toolkit's light/dark yellow palette. No client or review data is persisted or transmitted.

Review and validation warnings share `createAcknowledgements` and a Reviewed button helper. Red errors and yellow warnings both have an Ignore button. Ignoring removes the item from the Checker attention list and preserves its review decision in memory. Existing SSA readiness checks still identify invalid, missing, conflicting and ambiguous answers; ignoring an item does not fabricate or repair an answer. Each rendering owns an in-memory Set keyed by item identity, keeping repeated-record issues independent. Original results are never mutated. Dismissal removes the acknowledged row and validation counts use the remaining items. “All validation issues reviewed” is not a success result; genuine success requires the validator to return zero issues and complete parsing. Every raw-text check/edit, Clear, or page exit discards the UI state. SSA corrections preserve unrelated unchanged dismissals and reconsider affected ones. No acknowledgement state is stored outside the current rendering.

Required sections with no required information produce one section-level issue; partially completed sections retain individual missing-field issues. Medical provider records require a clinic name or doctor name, current-spouse maiden name and SSN are optional, previous marriage records require Type of Marriage when recognized marriage details exist, and children are optional. School name, City and State are required; other school fields are optional. Height inches accepts numeric and string zero as provided.

Conditions: more than ten distinct exact-text medical problems; explicit Yes/true for Currently working in EMPLOYMENT INFORMATION and Used other names in medical records in OTHER NAMES; exact Separated marital status; work-history attempts starting after disability onset and lasting no more than three calendar months; and the Financial Support receipt fields for veteran benefits, retirement/pension, and borrowing money. Income produces one consolidated item. Amounts alone and ambiguous housing, family/friend support, part-time work, unspecified support, and other wage fields are not used. Food Stamps do not trigger income review. These items remain outside validation counts and link to the existing Things to Notate in Remarks section in Canned Remarks.

Separated is a general notification for later notation, not a validation error. No separation is inferred from incomplete spouse information.

Failed-work review evaluates heading-recognized jobs starting strictly after the established disability onset date and lasting up to and including three calendar months. Onset, start and end must have full day precision; last-work dates are never substituted for onset. Month-end clamping and UTC arithmetic avoid timezone/DST drift. Missing, invalid, month-only, conflicting or reversed dates are skipped. Identical and format-equivalent duplicate dates are treated as one answer. Find in Intake uses the original record heading range.

Conditional checks cover employment history, at least one medical problem, provider visit dates, current-calendar-year job addresses, and current spouse requirements. Vehicles are optional. Security-question parent names, height inches, and marital status are optional. School name where highest grade completed, School City and School State are the only required School Information fields. Work-history Business Type remains scoped and required per applicable record. Configured people/place names are normalized to letters/spaces and Title Case; street addresses also allow digits. Email and free text are not case-converted. Original source values are preserved. Prior marriages are not checked until exact labels are supplied. Total Earnings remains deferred because the current exact parser/schema has no supported field with that label.

Dates accept YYYY-MM-DD, YYYY-MM, M/D/YYYY, M/YYYY, and English month names (full or three letters) with a year and optional day. Invalid calendar formats are red errors across configured date fields, including lone provider dates. Same-month visit dates without day precision require review. Invalid job End Date creates a format error and does not trigger address requirements.

Section and field matching is exact. School fields may be directly under EDUCATION INFORMATION or under SCHOOL INFORMATION. Repeating records are scoped to the rulebook's named section, identified by a configured heading or known required fields. Unknown record structures (including child records with neither known name label) receive a review warning instead of invented missing-field errors. No records from unrelated optional sections are borrowed to satisfy required fields. The validation report does not claim overall intake completeness when parsing or rules are incomplete.

Tests: `node --test --test-isolation=none tests/*.test.js tests/*.test.mjs`

Local preview: `npm.cmd run dev`, then open `/intake-checker/`. Production build: `npm.cmd run build`.

## Workspace and source locations

The shared Toolkit panel contains a 45/55 input/report grid above 1080px; smaller screens stack the report below the input. The textarea defaults to a fixed 350px on desktop and 260px on narrower screens, with internal scrolling and vertical resizing down to 180px. The input column aligns to the top without stretching to the report height. The desktop report scrolls independently. Review and Validation Report are separated by a divider, without a preceding parsed-intake heading or summary. Both tools remain available at their direct URLs and in the Toolkit registry.

The parser stores original UTF-16 field and heading ranges in a WeakMap keyed by its existing nodes. No labels/values or validation rules change. `issueSource` follows the validation issue record path, then resolves the exact field within that record. Missing fields fall back to the record/section heading; absent sections have no locate action.

Find in Intake focuses the textarea and selects the source range without changing text. A temporary, invisible measuring element estimates wrapped line position and is immediately removed. Selection is exact; scroll centering can vary slightly with browser typography, wrapping, or zoom. Editing clears results and locate callbacks, and Clear removes all content/selection state.

## SSA preparation (v1.11.0)

Continue to SSA Intake Assistant exposes the existing parsed fields, validation, source locations, and review decisions through the versioned in-memory client-profile contract. The dashboard summarizes readiness without a duplicate confirmation step. General Reviewed dismissals do not alter answers.

Blocked-field corrections update this same Checker session and rerun its existing rules. A correction ledger appears below the input; the pasted text remains the original source. Back retains state, while editing/rechecking that text starts a fresh session. Nothing is persisted or transmitted. See ../ssa-intake-assistant/PROFILE-CONTRACT.md for the field audit and future mapping rules.

## Shared format validation

The Checker owns formats.js and values.js. Validation returns a page-memory Map keyed by original parser fields. The SSA adapter consumes those results rather than applying another format rulebook. The original textarea, raw candidates and UTF-16 source ranges are unchanged. Formatted answers are available below the input; normalization is not marked as an employee correction.

- Scoped people/place names (including clinic, school and employer names): Unicode letters/spaces, Title Case. Street addresses also retain digits. Punctuation is removed under the interim approved policy.
- Phones: exactly 10 digits, displayed 000-000-0000. SSNs: exactly nine, displayed 000-00-0000. ZIPs: exactly five. Existing formatting is removed for counting; no digit padding/truncation, country-code stripping or extension guessing.
- Emails retain characters/case and receive a practical syntax check, not mailbox verification. Quoted local parts/domain literals are currently unsupported. Free text, notes and unknown labels remain unchanged.
- Calendar-valid dates accept existing ISO, slash and English-month formats. Month/year stays month precision. No new age/future-date or date-order business rule is introduced here.
- Existing mapped amounts allow digits, optional decimal point and optional leading dollar sign. No currency conversion or inferred unit. Commas, negative amounts and written units currently require correction.
- Missing required answers/invalid formats appear red until corrected or ignored in the Checker list. Yellow warnings can also be ignored without changing an answer. SSA readiness still distinguishes ignoring a validation item from repairing the underlying answer.

### Final review checklist for Sam

Revisit permitted punctuation (including periods, commas, apostrophes, quotes and hyphens) and whether month/year dates are sufficient before final sign-off. These are interim policies. The approved duplicate, nested-record, medical-count, visit-date and review-reset fixes are included in this unreleased milestone.

## Duplicate answers

One comparison helper serves validation, review, and the client profile. Within the same field and subject, identical answers and answers equal after the approved format normalization are treated as one answer. Every original occurrence and source range remains intact. Free-text differences are not erased. Blank versus supplied answers conflict; blank-only duplicates remain missing. Conflicts are red errors with a Find answer action for each occurrence, can be ignored in the Checker attention list, but conflicting values still require source correction before becoming fillable. Invalid repeated values still fail format checks.

Separate jobs, providers, children and spouses are never merged by name. Repeated singleton sections remain ambiguous in the profile because subject identity is not established; different values across those sections also produce a red conflict. Identical medical-condition text across numbered labels is combined with all original source labels and ranges retained. Missing and conflicting answers remain explicit, and no fuzzy matching or diagnosis inference is used.

Recognized repeating records are validated at every nesting depth, including beneath another recognized record. Required answers are never borrowed from a parent or sibling. Existing current-year job address, provider visit-date and marriage-detail conditions also apply to nested records. Children remain optional; unknown leaf structures retain review warnings. Original record paths and source locations are preserved.

Standalone question labels ending in a colon inside a recognized section are retained with their following answers, even when not mapped. Unknown same-line colon questions remain unparsed instead of appended to the preceding answer. Each unparsed line produces a red, source-linked parsing error; unsupported input with no recognized sections shows a red message without invented validation results. Ordinary multiline free text is preserved. Ambiguous colon lines require source review rather than guessed assignment.

Reversed provider visit dates flag both First Visit Date and Last Visit Date in red. Same-month dates lacking day precision keep the yellow order-review warning. No/false for Have you ever worked exempts last-work requirements, including grouped missing-section requirements transferred to the profile.

Corrections re-evaluate all rules in memory. Changes to onset or job dates reset affected failed-work dismissals; unrelated flags remain dismissed. First/last visit changes reset date-order review; unrelated provider changes preserve it. Medical-answer and income-receipt changes reset their respective review flags, while an income amount edit alone does not reset the general income flag.

## Scoped parsing review (v1.11.0)
Unparsed lines retain the containing parser node in page-memory metadata. The validator exposes its path, line number and original range. Unclear text blocks that section/record and descendants in the profile; sibling records and other sections remain independently eligible. Text outside recognized sections stays an unresolved requirement, without invalidating established answers. No label or answer is guessed.

The observed export prefix (Print as PDF, Intake Form, display-name line, Generated on timestamp, then PERSONAL INFORMATION) is recognized as document metadata. It remains in the original textarea and is never used to fill answers. Source offsets are unchanged. Only this structured prefix is recognized; arbitrary prefaces remain reviewable. Standalone unknown labels are preserved structurally, without adding validation or SSA question mappings.

Ignoring applies to missing, format, conflict and parsing errors as well as yellow warnings. Rechecking starts a new review; related edits reset affected decisions, while unrelated dismissals survive. Clearing, reloading or closing discards all decisions. Ignoring every item does not relabel the underlying data as valid.

Notification cards use compact padding, paragraph margins and action spacing, with larger touch controls on mobile. Reviewed/ignored decisions carry into SSA preparation and do not reappear as active notices on Continue/Back. Rechecking or related edits can reset them as documented above.
