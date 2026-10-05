import { sourceRange } from '../../../intake-checker/parser.js';
import { intakeRules } from '../../../intake-checker/rules.js';
import { isMissing, parseCalendarDate } from '../../../intake-checker/validation.js';
import { cleanExtractedValue } from './validation.js';
import { fieldDefinitions, medicalProblemDefinition, PROFILE_SCHEMA_VERSION } from './intake-contract.js';

function flatten(nodes, parentPath = '', ancestors = []) {
  return nodes.flatMap((node, index) => {
    const entry = { node, path: `${parentPath}/${index}`, ancestors };
    return [entry, ...flatten(node.subsections, entry.path, [...ancestors, entry])];
  });
}

// Contract encoding only. All business validation comes from Intake Checker.
function encode(value, type) {
  const raw = String(value ?? '').trim();
  if (isMissing(value) || !cleanExtractedValue(value) || /^(?:[-—–?]+|null|undefined|nan|not applicable|not available|tbd|select(?: one| an option)?|choose(?: one| an option)?)$/i.test(raw)) {
    return { value: null, precision: null, missing: true, reason: 'No established answer: blank or placeholder.' };
  }
  if (type === 'date') {
    const date = parseCalendarDate(raw);
    if (!date) return { value: null, precision: null, missing: true, reason: 'No valid calendar date in a supported Intake Checker format.' };
    const month = `${date.year}-${String(date.month).padStart(2, '0')}`;
    return { value: date.precision === 'day' ? `${month}-${String(date.day).padStart(2, '0')}` : month, precision: date.precision };
  }
  if (type === 'boolean') {
    if (/^(yes|true|no|false)$/i.test(raw)) return { value: /^(yes|true)$/i.test(raw), precision: null };
    return { value: null, precision: null, ambiguous: true, reason: 'The source does not establish an explicit Yes/No answer.' };
  }
  return { value: raw, precision: null };
}

export function fromIntakeChecker(session) {
  const { parsed, report, review, validationState, reviewState } = session;
  const remaining = validationState.remaining();
  const remainingReview = reviewState.remaining();
  const validationIssues = report.issues.map((issue, index) => ({ ...issue, id: `validation-${index}`, acknowledged: !remaining.includes(issue) }));
  const reviewDecisions = review.items.map((item, index) => ({ ...item, id: `review-${index}`, acknowledged: !remainingReview.includes(item), kind: 'general-review' }));
  const entries = flatten(parsed.sections);
  const claimed = new Set(), associatedIssues = new Set();
  const fields = [];

  function addField(definition, nodes, { recordId = null, ambiguousScope = false, unsupported = false, label = definition.label } = {}) {
    const candidates = nodes.flatMap(entry => entry.node.fields.filter(field => field.label === label).map(field => ({ entry, field })));
    const issues = validationIssues.filter(issue => {
      if (issue.section !== definition.section || issue.field && issue.field !== label) return false;
      if (issue.record && !nodes.some(entry => entry.node.title === issue.record)) return false;
      return issue.location ? nodes.some(entry => entry.path === issue.location) : true;
    });
    // Do not invent optional answers or hypothetical repeat records.
    const rule = definition.record ? intakeRules.records[definition.category] : intakeRules.sections[definition.section];
    const requiredBySection = issues.some(issue => !issue.field) && rule?.required?.includes(label);
    if (!candidates.length && !issues.some(issue => issue.field === label) && !requiredBySection) return;
    candidates.forEach(({ field }) => claimed.add(field));
    issues.forEach(issue => associatedIssues.add(issue.id));
    const encodings = candidates.map(({ field }) => encode(field.value, definition.dataType));
    const encoded = encodings[0] || encode(null, definition.dataType);
    // Keep contradictory source answers, including missing versus supplied, visible.
    const distinct = new Set(candidates.map(({ field }) => String(field.value ?? '').trim()));
    const conflict = distinct.size > 1;
    const blockingReasons = [];
    if (encoded.missing) blockingReasons.push({ code: 'missing', message: encoded.reason });
    if (conflict) blockingReasons.push({ code: 'conflict', message: 'Competing values for the same field. Resolve them in the pasted intake.' });
    if (unsupported || ambiguousScope || parsed.unparsed.length || encoded.ambiguous) {
      blockingReasons.push({ code: 'ambiguous', message: unsupported ? 'Intake Checker retains this field but has no established mapping for this label and source context.' : ambiguousScope ? 'Repeated or ambiguous source sections do not establish a unique subject.' : parsed.unparsed.length ? 'The intake contains unparsed text. Resolve it in Intake Checker before using this profile.' : encoded.reason });
    }
    // Dismissal is not a repair. An error still present in the validator stays blocked.
    const unresolved = issues.filter(issue => issue.severity === 'error' || !issue.acknowledged);
    unresolved.forEach(issue => blockingReasons.push({ code: 'validation', issueId: issue.id, message: issue.message + (issue.acknowledged ? ' Reviewed in Intake Checker; the validation error still requires correction.' : '') }));
    const edits = candidates.flatMap(({ field }) => session.edits?.get(field)?.changes || []);
    const sources = candidates.map(({ entry, field }) => ({
      section: definition.parent && entry.node.title === definition.parent ? entry.node.title : definition.section,
      record: recordId ? entry.node.title : null,
      nodePath: entry.path, label, range: sourceRange(field),
      rawValue: session.edits?.has(field) ? session.edits.get(field).originalValue : field.value,
    }));
    const relevantReviews = reviewDecisions.filter(item => item.range && sources.some(source => source.range && item.range.start <= source.range.end && item.range.end >= source.range.start));
    const acknowledgements = [...issues, ...relevantReviews].filter(item => item.acknowledged).map(item => item.id);
    const correctionAllowed = !unsupported && !ambiguousScope && !parsed.unparsed.length && candidates.length <= 1 && nodes.length <= 1;
    fields.push({
      id: recordId ? `${definition.id}@${recordId}` : definition.id,
      definitionId: definition.id, recordId, category: definition.category, label,
      dataType: definition.dataType, value: conflict ? null : encoded.value, precision: encoded.precision,
      sources, origin: edits.length ? 'employee_entered' : candidates.length ? 'parsed' : 'absent',
      validation: { status: unresolved.length ? 'unresolved' : issues.length ? 'acknowledged' : 'no_issues', issues },
      employeeReview: { status: edits.length ? 'employee_entered' : acknowledgements.length ? 'acknowledged' : 'not_reviewed', acknowledgements, edits },
      readiness: blockingReasons.length ? 'blocked' : 'ready', blockingReasons,
      correctionTarget: correctionAllowed ? { nodePath: nodes[0]?.path || null, section: definition.section, label, range: sources[0]?.range || null } : null,
    });
  }

  const singletonGroups = new Map();
  for (const definition of fieldDefinitions.filter(definition => !definition.record)) {
    const group = singletonGroups.get(definition.section) || [];
    group.push(definition); singletonGroups.set(definition.section, group);
  }
  for (const [section, definitions] of singletonGroups) {
    let nodes = entries.filter(entry => entry.node.title === section);
    if (!nodes.length && definitions[0].parent) nodes = entries.filter(entry => entry.node.title === definitions[0].parent);
    for (const definition of definitions) addField(definition, nodes, { ambiguousScope: nodes.length > 1 });
  }
  for (const [category, rule] of Object.entries(intakeRules.records)) {
    const roots = entries.filter(entry => entry.node.title === rule.section);
    const records = entries.filter(entry => entry.ancestors.some(parent => roots.includes(parent)) && (
      rule.heading?.test(entry.node.title) || category !== 'spouse' && entry.node.fields.some(field => [...(rule.required || []), ...(rule.recognition || [])].includes(field.label))
    ));
    records.forEach((entry, index) => {
      for (const definition of fieldDefinitions.filter(definition => definition.record && definition.category === category)) {
        addField(definition, [entry], { recordId: `${category}-${index + 1}`, ambiguousScope: roots.length > 1 || category === 'spouse' && records.length > 1 });
      }
    });
  }
  let problemIndex = 0;
  for (const entry of entries.filter(entry => entry.node.title === 'MEDICAL PROBLEMS' || entry.ancestors.some(parent => parent.node.title === 'MEDICAL PROBLEMS'))) {
    for (const label of new Set(entry.node.fields.filter(field => intakeRules.medicalProblemLabel.test(field.label)).map(field => field.label))) {
      addField(medicalProblemDefinition, [entry], { label, recordId: `problem-${++problemIndex}` });
    }
  }
  // Lossless fallback: arbitrary bold labels are accepted by the parser, never silently dropped.
  for (const entry of entries) for (const [index, field] of entry.node.fields.entries()) {
    if (claimed.has(field)) continue;
    const definition = { id: `unsupported.${entry.path.slice(1).replaceAll('/', '-')}.${index}`, category: 'unsupported', section: entry.node.title, label: field.label, dataType: 'text' };
    addField(definition, [entry], { unsupported: true });
  }
  return {
    schema: 'packard.intake-client-profile', schemaVersion: PROFILE_SCHEMA_VERSION, revision: session.revision || 0,
    source: { kind: 'intake-checker', toolVersion: '1.7.0' }, fields,
    validationIssues, reviewDecisions,
    requirements: validationIssues.filter(issue => !associatedIssues.has(issue.id)),
    unparsed: parsed.unparsed.map(item => ({ ...item })), deferred: [...report.deferred],
  };
}
