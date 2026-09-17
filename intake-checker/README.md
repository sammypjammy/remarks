# Intake Checker

Part of the Toolkit's existing Vite build. No intake data is sent, logged, or stored; Clear and leaving the page remove the current input/results.

`parseIntake(text)` returns `{ sections, unparsed }`. Sections and subsections have an exact `title`, ordered `fields: [{ label, value }]`, and `subsections`. Arrays intentionally preserve repeated labels and identically named records. `unparsed` retains unmatched text with source line numbers; it drives parsing completeness handling. There is no user-facing JSON/debug view.

Supported format:

- Plain section headings and exact field labels reuse the centralized rules plus known conditional labels. Both `Label: value` and `Label:` followed by value lines are supported.
- Known plain record headings (Clinic 1, Medication 1, Most Recent Job, Current Spouse, etc.) start separate records. Arbitrary uppercase text and unknown colon labels are not promoted to structure.

- Standalone `**SECTION**` or Markdown headings levels 1–3 start main sections.
- Headings levels 4–6 start subsections; heading depth determines nesting. Names need not contain numbers.
- `**Label:**value` and `**Label**:value` start fields. Subsequent lines belong to that value until the next recognized field or heading.
- Empty/whitespace values and `Not provided` (with or without asterisks) become `null`. Other values remain text.

Summary counts identify numbered Clinic, Hospital, Doctor, Medical Provider, Medication, and Job headings, plus Most Recent Job and Previous Job. Unknown categories are omitted rather than reported as zero. Counts are records, not deduplicated people. Client names use unambiguous First Name/Last Name fields under PERSONAL INFORMATION.

Limitations: unknown plain-text labels/headings, tables, HTML, and multiple fields on the same line are not supported. A standalone bold line within a free-text answer is interpreted as a section; other unmarked continuation text is treated as part of the previous value. Answers exactly matching known headings or labels can be ambiguous; review the pasted source text.

## V1 validation

Flow: `parser.js` → structured intake → independent `review.js` and `validation.js` → UI. The UI skips both systems when no sections are recognized, showing a parsing review message. Validation rules remain unchanged from v2.9.2. `rules.js` centralizes exact required/optional labels, record recognition, and the deferred prior-marriage rule. `validateIntake(intake, rules, { now })` returns structured issues with section, record when applicable, field, severity, reason, and a record location. The default clock is the user's local date; tests inject a fixed date. The developer-only deferred-rule note is not displayed in the report.

## Review

`reviewIntake(parsed)` returns a masked identifier, email, and review items with parser source ranges. It does not mutate parsed data or validation results. The plain-text parser recognizes the exact optional labels in `review-fields.js`, supplied with the release request, without adding required fields. Review uses native keyboard-accessible buttons styled as plain text and the Clipboard API; copy failures are reported without replacing the displayed value. The identifier joins the name and last four with a space. Review flags use the Toolkit's light/dark yellow palette. No client or review data is persisted or transmitted.

Review and Validation share `createAcknowledgements` and a Reviewed button helper. Each rendering owns an in-memory Set keyed by item identity, keeping repeated-record issues independent. Original results are never mutated. Dismissal removes the acknowledged row and validation counts use the remaining items. “All validation issues reviewed” is not a success result; genuine success requires the validator to return zero issues and complete parsing. Every check, edit, Clear, or page exit discards the UI state. No acknowledgement state is stored outside the current rendering.

Conditions: more than ten populated medical problems; explicit Yes/true for Currently working in EMPLOYMENT INFORMATION, Used other names in medical records in OTHER NAMES, and the Financial Support receipt fields for veteran benefits, retirement/pension, and borrowing money. Income produces one consolidated item. Amounts alone and ambiguous housing, family/friend support, part-time work, unspecified support, and other wage fields are not used. Food Stamps do not trigger income review.

TODO: Separation requires a confirmed exact DeLorean field/value. Neither incomplete spouse information nor an unconfirmed marital-status enum is used.

Failed work attempts evaluate each recognized WORK HISTORY record independently: valid day-precision Start Date strictly after Onset date of disability, End Date on/after Start Date and on/before the three-calendar-month anniversary. The anniversary clamps month ends (January 31 → April 30); UTC calendar arithmetic avoids timezone/DST drift. Missing, invalid, month-only, or duplicate dates are skipped. Find in Intake uses the original record heading range, including separate ranges for repeated headings.

Conditional checks cover vehicle ownership, at least one medical problem, provider visit dates, current-calendar-year job addresses, and current spouse requirements. Child records require only First Name and Last Name. Prior marriages are not checked until exact labels are supplied.

Dates accept YYYY-MM-DD, YYYY-MM, M/D/YYYY, M/YYYY, and English month names (full or three letters) with a year and optional day. Provider dates that cannot be compared produce review warnings, not guessed date errors. Same-month visit dates without day precision require review. Invalid job End Date does not trigger new date rules or address requirements.

Section and field matching is exact. School fields may be directly under EDUCATION INFORMATION or under SCHOOL INFORMATION. Repeating records are scoped to the rulebook's named section, identified by a configured heading or known required fields. Unknown record structures (including child records with neither known name label) receive a review warning instead of invented missing-field errors. No records from unrelated optional sections are borrowed to satisfy required fields. The validation report does not claim overall intake completeness when parsing or rules are incomplete.

Tests: `node --test --test-isolation=none tests/*.test.js intake-checker/*.test.js`

Local preview: `npm.cmd run dev`, then open `/intake-checker/`. Production build: `npm.cmd run build`.

## Workspace and source locations

The shared Toolkit panel contains a 45/55 input/report grid above 1080px; smaller screens stack the report below the input. The textarea defaults to a fixed 350px on desktop and 260px on narrower screens, with internal scrolling and vertical resizing down to 180px. The input column aligns to the top without stretching to the report height. The desktop report scrolls independently. Review and Validation Report are separated by a divider, without a preceding parsed-intake heading or summary. Both tools remain available at their direct URLs, but Intake Checker and Fax Sender are temporarily absent from home cards and navigation.

The parser stores original UTF-16 field and heading ranges in a WeakMap keyed by its existing nodes. No labels/values or validation rules change. `issueSource` follows the validation issue record path, then resolves the exact field within that record. Missing fields fall back to the record/section heading; absent sections have no locate action.

Find in Intake focuses the textarea and selects the source range without changing text. A temporary, invisible measuring element estimates wrapped line position and is immediately removed. Selection is exact; scroll centering can vary slightly with browser typography, wrapping, or zoom. Editing clears results and locate callbacks, and Clear removes all content/selection state.
