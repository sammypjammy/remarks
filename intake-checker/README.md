# Intake Checker

Part of the Toolkit's existing Vite build. No intake data is sent, logged, or stored; Clear and leaving the page remove the current input/results.

`parseIntake(text)` returns `{ sections, unparsed }`. Sections and subsections have an exact `title`, ordered `fields: [{ label, value }]`, and `subsections`. Arrays intentionally preserve repeated labels and identically named records. `unparsed` retains unmatched text with source line numbers; it drives the parsing review notice. There is no user-facing JSON/debug view.

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

Flow: `parser.js` → `validation.js` → UI report. The UI skips validation when no sections are recognized, showing a parsing review message. Validation rules are unchanged in v2.9.2. `rules.js` centralizes exact required/optional labels, record recognition, and the deferred prior-marriage rule. `validateIntake(intake, rules, { now })` returns structured issues with section, record when applicable, field, severity, reason, and a record location. The default clock is the user's local date; tests inject a fixed date.

Conditional checks cover vehicle ownership, at least one medical problem, provider visit dates, current-calendar-year job addresses, and current spouse requirements. Child records require only First Name and Last Name. Prior marriages are not checked until exact labels are supplied.

Dates accept YYYY-MM-DD, YYYY-MM, M/D/YYYY, M/YYYY, and English month names (full or three letters) with a year and optional day. Provider dates that cannot be compared produce review warnings, not guessed date errors. Same-month visit dates without day precision require review. Invalid job End Date does not trigger new date rules or address requirements.

Section and field matching is exact. School fields may be directly under EDUCATION INFORMATION or under SCHOOL INFORMATION. Repeating records are scoped to the rulebook's named section, identified by a configured heading or known required fields. Unknown record structures (including child records with neither known name label) receive a review warning instead of invented missing-field errors. No records from unrelated optional sections are borrowed to satisfy required fields. The validation report does not claim overall intake completeness when parsing or rules are incomplete.

Tests: `node --test --test-isolation=none tests/*.test.js intake-checker/*.test.js`

Local preview: `npm.cmd run dev`, then open `/intake-checker/`. Production build: `npm.cmd run build`.

## Workspace and source locations

The shared Toolkit panel contains a 45/55 input/report grid above 1080px; smaller screens stack the report below the input. The desktop report scrolls independently. Both tools remain available at their direct URLs, but Intake Checker and Fax Sender are temporarily absent from home cards and navigation.

The parser stores original UTF-16 field and heading ranges in a WeakMap keyed by its existing nodes. No labels/values or validation rules change. `issueSource` follows the validation issue record path, then resolves the exact field within that record. Missing fields fall back to the record/section heading; absent sections have no locate action.

Find in Intake focuses the textarea and selects the source range without changing text. A temporary, invisible measuring element estimates wrapped line position and is immediately removed. Selection is exact; scroll centering can vary slightly with browser typography, wrapping, or zoom. Editing clears results and locate callbacks, and Clear removes all content/selection state.
