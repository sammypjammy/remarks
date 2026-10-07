import { intakeRules } from "./rules.js";

import { isMissing, parseCalendarDate } from './values.js';
import { resolveAnswers } from "./answers.js";
import { sourceRange, unparsedScope } from "./parser.js";
import { inspectFormats } from './formats.js';
export { isMissing, parseCalendarDate } from './values.js';

function flatten(nodes, path = "") {
  return nodes.flatMap((node, index) => {
    const location = `${path}/${index}`;
    return [{ node, location }, ...flatten(node.subsections, location)];
  });
}

export function validateIntake(intake, rules = intakeRules, { now = new Date() } = {}) {
  const issues = [];
  const formats = inspectFormats(intake);
  const all = flatten(intake.sections);
  const sections = title => all.filter(entry => entry.node.title === title);
  const values = (node, label) => (node?.fields || []).filter(field => field.label === label).map(field => field.value).filter(value => !isMissing(value));
  const issue = (context, field, message, severity = "error") => issues.push({ ...context, field, severity, message });
  const required = (node, fields, context) => {
    for (const field of fields) if (!values(node, field).length) issue(context, field, `${field} is required but was not provided.`);
  };
  const requiredSection = (node, fields, context, label) => {
    if (!fields.length) return;
    if (!node || !fields.some(field => values(node, field).length)) {
      issue({ ...context, requiredFields: [...fields] }, null, `${label} is required but was not provided.`);
      return;
    }
    required(node, fields, context);
  };
  const contextFor = (section, entry, record = false) => ({ section, ...(record ? { record: entry.node.title } : {}), location: entry.location });
  // Multiple conflicting values cannot silently choose which condition/date applies.
  function single(node, label) {
    return resolveAnswers(node.fields.filter(field => field.label === label), formats.results).value;
  }
  for (const [title, config] of Object.entries(rules.sections)) {
    let entries = sections(title);
    // School fields can be directly under EDUCATION INFORMATION or its named subsection.
    if (!entries.length && config.parent) entries = sections(config.parent);
    if (!entries.length) requiredSection(null, config.required, { section: title, location: null }, title);
    for (const entry of entries) {
      let requiredFields = config.required;
      if (title === "EMPLOYMENT INFORMATION") {
        const worked = single(entry.node, "Have you ever worked");
        if (/^(no|false)$/i.test(worked?.trim() || "")) requiredFields = requiredFields.filter(field => field !== "When did you last work");
      }
      requiredSection(entry.node, requiredFields, contextFor(title, entry), title);
    }
  }

  function records(config, root) {
    const found = [];
    function visit(entry) {
      for (const [index, node] of entry.node.subsections.entries()) {
        const next = { node, location: `${entry.location}/${index}` };
        const recognized = config.heading?.test(node.title) || node.fields.some(field => [...(config.required || []), ...(config.recognition || [])].includes(field.label));
        if (recognized) found.push(next);
        if (node.subsections.length) visit(next);
        else if (!recognized && !(config.allowEmptyRecords && !node.fields.length)) issue(contextFor(config.section, next, true), null, "Record structure is not recognized. Review the parsed structure; this record was not validated.", "warning");
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

  checkRecords("medications");
  checkRecords("children");
  checkRecords("jobs", undefined, (node, context, config) => {
    const end = parseCalendarDate(single(node, "End Date", context));
    // Missing/invalid End Date adds no new date rule. Only its presence is required.
    if (end?.year === now.getFullYear()) required(node, config.currentYearAddress, context);
  });
  checkRecords("providers", undefined, (node, context) => {
    if (!values(node, "Clinic Name").length && !values(node, "Doctor First Name").length && !values(node, "Doctor Last Name").length) {
      issue(context, "Clinic Name", "Clinic Name or a doctor name is required but was not provided.");
    }
    const firstValue = single(node, "First Visit Date", context);
    const lastValue = single(node, "Last Visit Date", context);
    const nextValue = single(node, "Next Visit Date", context);
    if (values(node, "First Visit Date").length && !values(node, "Last Visit Date").length) {
      issue(context, "Last Visit Date", "Last Visit Date is required when First Visit Date is provided.");
    }
    function date(value, field) {
      if (value === null) return null;
      const parsed = parseCalendarDate(value);
      // Invalid dates are reported once by the shared format checks below.
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
          issue(context, "First Visit Date", "First Visit Date must be on or before Last Visit Date.");
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
    const marriageFields = new Set([...spouse.required, ...spouse.optional]);
    const marriageEntries = flatten(root.node.subsections, root.location);
    const previousSpouses = marriageEntries.filter(entry => spouse.unsupportedHeadings?.test(entry.node.title));
    for (const entry of marriageEntries) {
      if (previousSpouses.some(previous => entry.location === previous.location || entry.location.startsWith(previous.location + "/"))) continue;
      if (entry.node.fields.some(field => marriageFields.has(field.label)) && !values(entry.node, "Type of Marriage").length) {
        issue(contextFor("MARRIAGE INFORMATION", entry, true), "Type of Marriage", "Type of Marriage is required when marriage details are provided.");
      }
    }
    const current = marriageEntries.filter(entry => spouse.heading.test(entry.node.title));
    for (const entry of current.slice(1)) {
      issue(contextFor("MARRIAGE INFORMATION", entry, true), null, "Only one Current Spouse record is supported.");
    }
    if (single(root.node, "Marital Status", context) !== "Married") continue;
    if (!current.length) {
      issue({ ...context, record: "Current Spouse" }, null, "Current Spouse record is required when Marital Status is Married.");
    }
    for (const entry of current) required(entry.node, spouse.required, contextFor("MARRIAGE INFORMATION", entry, true));
  }

  // Every label is checked, including optional and unsupported labels. Source
  // ranges allow staff to inspect each competing occurrence without choosing one.
  for (const { node, location } of all) {
    const ancestors = all.filter(entry => location.startsWith(entry.location + '/'));
    const owner = [...ancestors, { node }].reverse().find(entry =>
      rules.sections[entry.node.title] || rules.optionalSections.includes(entry.node.title)
      || Object.values(rules.records).some(rule => rule.section === entry.node.title)
      || entry.node.title === 'MEDICAL PROBLEMS');
    const section = node.title === 'EDUCATION INFORMATION' && !sections('SCHOOL INFORMATION').length
      ? 'SCHOOL INFORMATION' : owner?.node.title || node.title;
    const sameSection = rules.sections[node.title] || rules.optionalSections.includes(node.title);
    const peers = sameSection ? sections(node.title) : [{ node, location }];
    if (peers[0].node !== node) continue;
    const fields = peers.flatMap(entry => entry.node.fields);
    for (const label of new Set(fields.map(field => field.label))) {
      const answer = resolveAnswers(fields.filter(field => field.label === label), formats.results);
      if (!answer.conflict) continue;
      issues.push({ section, ...(node.title !== section ? { record: node.title } : {}), location: peers.length > 1 ? null : location,
        field: label, severity: 'error', code: 'conflict',
        message: label + ' has conflicting answers. Correct the competing entries in the pasted intake.',
        sources: answer.fields.map(sourceRange).filter(Boolean) });
    }
  }
  for (const item of intake.unparsed) {
    const scope = all.find(entry => entry.node === unparsedScope(item));
    issue({ section: 'PARSING', location: null, code: 'parsing', line: item.line,
      scopePath: scope?.location || null, scopeTitle: scope?.node.title || null,
      sources: [sourceRange(item)].filter(Boolean) }, null,
      'Line ' + item.line + ' could not be assigned reliably.' + (scope ? ' Answers in ' + scope.node.title + ' need source review.' : ' This text is outside any recognized section.') + ' Correct its label or placement in the pasted intake.');
  }
  issues.push(...formats.issues);
  return { issues, deferred: [...rules.deferred], formats: formats.results };
}
