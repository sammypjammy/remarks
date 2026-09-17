# Intake Checker

Part of the Toolkit's existing Vite build. No intake data is sent, logged, or stored; Clear and leaving the page remove the current input/results.

`parseIntake(text)` returns `{ sections, unparsed }`. Sections and subsections have an exact `title`, ordered `fields: [{ label, value }]`, and `subsections`. Arrays intentionally preserve repeated labels and identically named records. `unparsed` retains unmatched text with source line numbers; it is visible only in the local debug view.

Supported format:

- Plain section headings and exact field labels reuse the centralized rules plus known conditional labels. Both `Label: value` and `Label:` followed by value lines are supported.
- Known plain record headings (Clinic 1, Medication 1, Most Recent Job, Current Spouse, etc.) start separate records. Arbitrary uppercase text and unknown colon labels are not promoted to structure.

- Standalone `**SECTION**` or Markdown headings levels 1–3 start main sections.
- Headings levels 4–6 start subsections; heading depth determines nesting. Names need not contain numbers.
- `**Label:**value` and `**Label**:value` start fields. Subsequent lines belong to that value until the next recognized field or heading.
- Empty/whitespace values and `Not provided` (with or without asterisks) become `null`. Other values remain text.

Summary counts identify numbered Clinic, Hospital, Doctor, Medical Provider, Medication, and Job headings, plus Most Recent Job and Previous Job. Unknown categories are omitted rather than reported as zero. Counts are records, not deduplicated people. Client names use unambiguous First Name/Last Name fields under PERSONAL INFORMATION.

Limitations: unknown plain-text labels/headings, tables, HTML, and multiple fields on the same line are not supported. A standalone bold line within a free-text answer is interpreted as a section; other unmarked continuation text is treated as part of the previous value. Answers exactly matching known headings or labels can be ambiguous; compare the debug view with the source.

## V1 validation

Flow: `parser.js` → `validation.js` → UI report. The UI skips validation when no sections are recognized, showing a parsing review message and retaining the debug view. Validation rules are unchanged in v2.9.1. `rules.js` centralizes exact required/optional labels, record recognition, and the deferred prior-marriage rule. `validateIntake(intake, rules, { now })` returns structured issues with section, record when applicable, field, severity, reason, and a record location. The default clock is the user's local date; tests inject a fixed date.

Conditional checks cover vehicle ownership, at least one medical problem, provider visit dates, current-calendar-year job addresses, and current spouse requirements. Child records require only First Name and Last Name. Prior marriages are not checked until exact labels are supplied.

Dates accept YYYY-MM-DD, YYYY-MM, M/D/YYYY, M/YYYY, and English month names (full or three letters) with a year and optional day. Provider dates that cannot be compared produce review warnings, not guessed date errors. Same-month visit dates without day precision require review. Invalid job End Date does not trigger new date rules or address requirements.

Section and field matching is exact. School fields may be directly under EDUCATION INFORMATION or under SCHOOL INFORMATION. Repeating records are scoped to the rulebook's named section, identified by a configured heading or known required fields. Unknown record structures (including child records with neither known name label) receive a review warning instead of invented missing-field errors. No records from unrelated optional sections are borrowed to satisfy required fields. The validation report does not claim overall intake completeness when parsing or rules are incomplete.

Tests: `node --test --test-isolation=none tests/*.test.js intake-checker/*.test.js`

Local preview: `npm.cmd run dev`, then open `/intake-checker/`. Production build: `npm.cmd run build`.
