import { intakeRules } from "./rules.js";
import { reviewFields } from "./review-fields.js";

const definitions = [...Object.values(intakeRules.sections), ...Object.values(intakeRules.records)];
const plainSections = new Set([
  ...Object.keys(intakeRules.sections), ...intakeRules.optionalSections,
  ...definitions.flatMap(rule => [rule.section, rule.parent].filter(Boolean)), "MEDICAL PROBLEMS"
]);
const plainFields = new Set(definitions.flatMap(rule => [
  ...(rule.required || []), ...(rule.optional || []), ...(rule.currentYearAddress || [])
]));
// Known conditional/optional labels not listed in the required-field configuration.
for (const label of ["Last Visit Date", "Have you ever worked", "Used other names in medical records", "Other first name", "Other last name", "Remarks/Comments"]) plainFields.add(label);
const plainRecords = Object.values(intakeRules.records).filter(rule => rule.heading);
for (const label of reviewFields) plainFields.add(label);

// Internal metadata follows node lifetime; it does not change the validation data shape.
const sourceRanges = new WeakMap();
const unparsedScopes = new WeakMap();
export const unparsedScope = item => unparsedScopes.get(item) || null;
export const sourceRange = node => sourceRanges.get(node) || null;

// Ordered arrays preserve duplicate headings/labels without inventing field names.
export function parseIntake(rawText) {
  const result = { sections: [], unparsed: [] };
  // Recognize only the observed export header, before PERSONAL INFORMATION.
  // Its display name/timestamp are document metadata, never answer sources.
  // Keep raw input intact so all later source offsets remain exact.
  const documentHeader = String(rawText).match(/^\s*Print as PDF[ \t]*\r?\n[ \t]*Intake Form[ \t]*\r?\n[ \t]*[\p{L}\p{M} .,'’\-]+[ \t]*\r?\n[ \t]*Generated on (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4} at \d{1,2}:\d{2} (?:AM|PM)[ \t]*(?:\r?\n\s*)+(?=PERSONAL INFORMATION(?:[ \t]*\r?\n|[ \t]*$))/u);
  const documentHeaderEnd = documentHeader?.[0].length || 0;
  let section = null;
  let stack = [];
  let field = null;
  let lines = [];
  function finishField() {
    if (!field) return;
    const value = lines.join("\n").trim();
    field.value = !value || /^(?:\*Not provided\*|Not provided)$/i.test(value) ? null : value;
    field = null;
    lines = [];
  }
  function node(title) { return { title, fields: [], subsections: [] }; }
  const unparsed = (index, rawLine, range) => {
    const item = { line: index + 1, text: rawLine };
    sourceRanges.set(item, range);
    unparsedScopes.set(item, stack.at(-1)?.node || section);
    result.unparsed.push(item);
  };
  let index = -1;
  // Preserve original UTF-16 offsets, including CRLF, for textarea selection APIs.
  for (const sourceLine of String(rawText).matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
    index++;
    if (sourceLine.index < documentHeaderEnd) continue;
    const rawLine = sourceLine[1];
    const range = { start: sourceLine.index, end: sourceLine.index + rawLine.length };
    const line = rawLine.trim();
    const plainField = line.match(/^([^:]+):(.*)$/);
    const knownField = plainField && (plainFields.has(plainField[1]) || intakeRules.medicalProblemLabel.test(plainField[1]));
    const match = line.match(/^\*\*(.+?):\*\*(.*)$/) || line.match(/^\*\*(.+?)\*\*:(.*)$/) || (knownField || section && plainField && !plainField[2].trim() ? plainField : null);
    const heading = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    const boldHeading = !match && line.match(/^\*\*([^*]+)\*\*$/);
    const plainSection = plainSections.has(line);
    const plainRecord = section && plainRecords.some(rule => rule.heading.test(line));
    if (heading || boldHeading || plainSection || plainRecord) {
      finishField();
      const level = heading ? heading[1].length : plainRecord ? 4 : 2;
      const title = (heading ? heading[2] : boldHeading ? boldHeading[1] : line).replace(/^\*\*(.*?)\*\*$/, "$1");
      const next = node(title);
      sourceRanges.set(next, range);
      if (level <= 3) {
        result.sections.push(next);
        section = next;
        stack = [];
      } else if (section) {
        while (stack.length && stack.at(-1).level >= level) stack.pop();
        (stack.at(-1)?.node || section).subsections.push(next);
        stack.push({ level, node: next });
      } else {
        unparsed(index, rawLine, range);
      }
    } else if (match) {
      finishField();
      const target = stack.at(-1)?.node || section;
      if (!target) unparsed(index, rawLine, range);
      else {
        field = { label: match[1], value: null };
        sourceRanges.set(field, range);
        target.fields.push(field);
        lines = [match[2]];
      }
    } else if (plainField) {
      // An unknown question must not become part of the previous answer.
      finishField();
      unparsed(index, rawLine, range);
    } else if (field) {
      lines.push(rawLine);
      if (rawLine.trim()) sourceRanges.get(field).end = range.end;
    } else if (line) {
      unparsed(index, rawLine, range);
    }
  }
  finishField();
  return result;
}

export function summarizeIntake(parsed) {
  const summary = { sections: parsed.sections.length };
  const personal = parsed.sections.filter(section => section.title.toUpperCase() === "PERSONAL INFORMATION");
  if (personal.length === 1) {
    const names = ["First Name", "Last Name"].map(label => personal[0].fields.filter(field => field.label === label));
    // Ambiguous duplicate name fields must not silently select a client.
    if (names.every(matches => matches.length <= 1)) {
      const name = names.map(matches => matches[0]?.value).filter(Boolean).join(" ");
      if (name) summary.client = name;
    }
  }
  const counts = { providers: 0, medications: 0, jobs: 0 };
  function visit(nodes) {
    for (const node of nodes) {
      if (/^(?:Clinic|Hospital|Doctor|Medical Provider)\s+\d+$/i.test(node.title)) counts.providers++;
      if (/^Medication\s+\d+$/i.test(node.title)) counts.medications++;
      if (/^(?:(?:Most Recent|Previous) Job|Job\s+\d+)$/i.test(node.title)) counts.jobs++;
      visit(node.subsections);
    }
  }
  for (const section of parsed.sections) visit(section.subsections);
  // Omit unknown categories rather than interpreting unrecognized headings as zero.
  for (const [key, value] of Object.entries(counts)) if (value) summary[key] = value;
  return summary;
}
