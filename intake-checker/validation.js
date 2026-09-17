import { intakeRules } from "./rules.js";

export function isMissing(value) {
  return value == null || (typeof value === "string" && /^(?:\s*|\s*(?:Not provided|\*Not provided\*)\s*)$/i.test(value));
}

// Explicit calendar formats only. Never use Date.parse's locale-dependent guessing.
export function parseCalendarDate(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let year, month, day;
  let match;
  if ((match = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) {
    [, year, month, day] = match;
  } else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    [, month, day, year] = match;
  } else if ((match = text.match(/^(\d{1,2})\/(\d{4})$/))) {
    [, month, year] = match;
  } else if ((match = text.match(/^([A-Za-z]+)\s+(?:(\d{1,2}),?\s+)?(\d{4})$/))) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    month = months.findIndex(name => name === match[1].toLowerCase() || name.slice(0, 3) === match[1].toLowerCase()) + 1;
    day = match[2]; year = match[3];
  } else return null;
  year = Number(year); month = Number(month);
  const precision = day === undefined ? "month" : "day";
  day = day === undefined ? 1 : Number(day);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  return { year, month, day, precision };
}

function flatten(nodes, path = "") {
  return nodes.flatMap((node, index) => {
    const location = `${path}/${index}`;
    return [{ node, location }, ...flatten(node.subsections, location)];
  });
}

export function validateIntake(intake, rules = intakeRules, { now = new Date() } = {}) {
  const issues = [];
  const all = flatten(intake.sections);
  const sections = title => all.filter(entry => entry.node.title === title);
  const values = (node, label) => (node?.fields || []).filter(field => field.label === label).map(field => field.value).filter(value => !isMissing(value));
  const issue = (context, field, message, severity = "error") => issues.push({ ...context, field, severity, message });
  const required = (node, fields, context) => {
    for (const field of fields) if (!values(node, field).length) issue(context, field, `${field} is required but was not provided.`);
  };
  const contextFor = (section, entry, record = false) => ({ section, ...(record ? { record: entry.node.title } : {}), location: entry.location });
  // Multiple conflicting values cannot silently choose which condition/date applies.
  function single(node, label, context) {
    const found = [...new Set(values(node, label))];
    if (found.length > 1) {
      issue(context, label, `${label} has multiple different values. Review this field; dependent checks were skipped.`, "warning");
      return null;
    }
    return found[0] ?? null;
  }
  for (const [title, config] of Object.entries(rules.sections)) {
    let entries = sections(title);
    // School fields can be directly under EDUCATION INFORMATION or its named subsection.
    if (!entries.length && config.parent) entries = sections(config.parent);
    if (!entries.length) required(null, config.required, { section: title, location: null });
    for (const entry of entries) required(entry.node, config.required, contextFor(title, entry));
  }

  function records(config, root) {
    const found = [];
    function visit(entry) {
      for (const [index, node] of entry.node.subsections.entries()) {
        const next = { node, location: `${entry.location}/${index}` };
        const recognized = config.heading?.test(node.title) || node.fields.some(field => config.required.includes(field.label));
        if (recognized) found.push(next);
        else if (node.subsections.length) visit(next);
        else issue(contextFor(config.section, next, true), null, "Record structure is not recognized. Review the parsed structure; this record was not validated.", "warning");
      }
    }
    visit(root);
    return found;
  }

  function checkRecords(key, condition = () => true, extra = () => {}) {
    const config = rules.records[key];
    for (const root of sections(config.section)) {
      if (!condition(root.node, contextFor(config.section, root))) continue;
      for (const entry of records(config, root)) {
        const context = contextFor(config.section, entry, true);
        required(entry.node, config.required, context);
        extra(entry.node, context, config);
      }
    }
  }

  checkRecords("vehicles", (node, context) => single(node, "Own any vehicles", context) === "Yes");
  checkRecords("medications");
  checkRecords("children");
  checkRecords("jobs", undefined, (node, context, config) => {
    const end = parseCalendarDate(single(node, "End Date", context));
    // Missing/invalid End Date adds no new date rule. Only its presence is required.
    if (end?.year === now.getFullYear()) required(node, config.currentYearAddress, context);
  });
  checkRecords("providers", undefined, (node, context) => {
    const firstValue = single(node, "First Visit Date", context);
    const lastValue = single(node, "Last Visit Date", context);
    const nextValue = single(node, "Next Visit Date", context);
    if (values(node, "First Visit Date").length && !values(node, "Last Visit Date").length) {
      issue(context, "Last Visit Date", "Last Visit Date is required when First Visit Date is provided.");
    }
    function date(value, field) {
      if (value === null) return null;
      const parsed = parseCalendarDate(value);
      if (!parsed) issue(context, field, "Date format is not recognized or the calendar date is invalid. Review this date; comparison was skipped.", "warning");
      return parsed;
    }
    // Last-only is valid; no inferred date is written back to the intake.
    if (firstValue !== null && lastValue !== null) {
      const first = date(firstValue, "First Visit Date");
      const last = date(lastValue, "Last Visit Date");
      if (first && last) {
        const firstMonth = first.year * 12 + first.month;
        const lastMonth = last.year * 12 + last.month;
        if (lastMonth < firstMonth || (lastMonth === firstMonth && first.precision === "day" && last.precision === "day" && last.day < first.day)) {
          issue(context, "Last Visit Date", "Last Visit Date must be on or after First Visit Date.");
        } else if (lastMonth === firstMonth && (first.precision === "month" || last.precision === "month")) {
          issue(context, "Last Visit Date", "Visit dates in the same month lack day precision. Review their order.", "warning");
        }
      }
    }
    const next = date(nextValue, "Next Visit Date");
    if (next && next.year * 12 + next.month < now.getFullYear() * 12 + now.getMonth() + 1) {
      issue(context, "Next Visit Date", "Next Visit Date must be in the current calendar month or a future month.");
    }
  });

  const problems = sections("MEDICAL PROBLEMS");
  if (!problems.some(root => flatten([root.node]).some(({ node }) => node.fields.some(field => rules.medicalProblemLabel.test(field.label) && !isMissing(field.value))))) {
    issue({ section: "MEDICAL PROBLEMS", location: null }, null, "At least one medical problem is required.");
  }

  const spouse = rules.records.spouse;
  for (const root of sections("MARRIAGE INFORMATION")) {
    const context = contextFor("MARRIAGE INFORMATION", root);
    if (single(root.node, "Marital Status", context) !== "Married") continue;
    const current = flatten(root.node.subsections, root.location).filter(entry => spouse.heading.test(entry.node.title));
    if (!current.length) {
      issue({ ...context, record: "Current Spouse" }, null, "Current Spouse record is required when Marital Status is Married.");
      required(null, spouse.required, { ...context, record: "Current Spouse" });
    }
    for (const entry of current) required(entry.node, spouse.required, contextFor("MARRIAGE INFORMATION", entry, true));
  }
  return { issues, deferred: [...rules.deferred] };
}
