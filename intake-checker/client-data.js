import { fieldDefinitions, medicalProblemDefinition, INTAKE_CHECKER_VERSION } from './field-catalog.js';
import { intakeRules } from './rules.js';
import { sourceRange, intakeSource, unparsedScope, summarizeIntake } from './parser.js';
import { issueSource } from './source-location.js';
import { resolveAnswers } from './answers.js';
import { isMissing, parseCalendarDate } from './values.js';
import { distinctMedicalProblemCount } from './medical-problems.js';
import { incomeFields } from './review-fields.js';

export const CLIENT_DATA_SCHEMA = 'packard.intake-checker.client-data';
export const CLIENT_DATA_VERSION = '1.1.0';
const knownSections = new Set([...Object.keys(intakeRules.sections), ...intakeRules.optionalSections,
  ...Object.values(intakeRules.records).map(rule => rule.section), 'MEDICAL PROBLEMS']);
const overlap = (a, b) => a && b && a.start <= b.end && a.end >= b.start;

// A detached snapshot of the existing session. This never parses again, validates
// again, writes to the session, or decides whether an SSA question can be filled.
export function createClientData(session) {
  const { parsed, report, review, validationState, reviewState } = session;
  const entries = [];
  function walk(nodes, parent = null, parentPath = '') {
    const counts = new Map();
    nodes.forEach((node, index) => {
      const ordinal = (counts.get(node.title) || 0) + 1;
      counts.set(node.title, ordinal);
      const entry = { node, path: `${parentPath}/${index}`, parent,
        id: `${parent?.id || 'scope'}/${encodeURIComponent(node.title)}~${ordinal}` };
      entries.push(entry);
      walk(node.subsections, entry, entry.path);
    });
  }
  walk(parsed.sections);
  const schoolFallback = !entries.some(entry => entry.node.title === 'SCHOOL INFORMATION');
  for (const entry of entries) {
    entry.section = schoolFallback && entry.node.title === 'EDUCATION INFORMATION' ? 'SCHOOL INFORMATION'
      : knownSections.has(entry.node.title) ? entry.node.title : entry.parent?.section || entry.node.title;
    entry.recordTypes = Object.entries(intakeRules.records).filter(([key, rule]) => {
      let ancestor = entry.parent;
      while (ancestor && ancestor.node.title !== rule.section) ancestor = ancestor.parent;
      return ancestor && (rule.heading?.test(entry.node.title) || key !== 'spouse' && entry.node.fields.some(field =>
        [...(rule.required || []), ...(rule.recognition || [])].includes(field.label)));
    }).map(([key]) => key);
  }
  const remaining = new Set(validationState.remaining());
  const remainingReview = new Set(reviewState.remaining());
  const validationIssues = report.issues.map((issue, index) => ({ ...issue, id: `validation-${index}`,
    dismissed: !remaining.has(issue), sources: issue.sources || [issueSource(parsed, issue)].filter(Boolean), fieldIds: [] }));
  const reviewItems = review.items.map((item, index) => ({ ...item, id: `review-${index}`,
    reviewed: !remainingReview.has(item), fieldIds: [] }));
  const fields = [], scopes = [];

  function buildScope(entry, definitions, absent = false) {
    const { node, section } = entry;
    const occurrenceIds = new Map();
    const scope = { id: entry.id, parentId: entry.parent?.id || null, nodePath: absent ? null : entry.path,
      title: node.title, section, recordTypes: entry.recordTypes || [], parsed: !absent && !!sourceRange(node),
      source: absent ? null : sourceRange(node), fieldIds: [] };
    scopes.push(scope);
    const labels = new Set([...definitions.map(definition => definition.label), ...node.fields.map(field => field.label)]);
    for (const label of labels) {
      const candidates = node.fields.filter(field => field.label === label);
      const numbered = section === 'MEDICAL PROBLEMS' && intakeRules.medicalProblemLabel.test(label);
      const definition = definitions.find(item => item.label === label) || (numbered ? medicalProblemDefinition : null);
      const definitionId = definition?.id || `unmapped:${encodeURIComponent(label)}`;
      const id = `${definitionId}@${scope.id}${numbered ? '/' + encodeURIComponent(label) : ''}`;
      const issues = validationIssues.filter(issue => {
        if (issue.code === 'parsing') return issue.scopePath && (entry.path === issue.scopePath || entry.path?.startsWith(issue.scopePath + '/'));
        if (issue.section !== section || issue.location && issue.location !== entry.path) return false;
        if (issue.record && issue.record !== node.title) return false;
        if (issue.field) return issue.field === label;
        return !issue.requiredFields || issue.requiredFields.includes(label);
      });
      issues.forEach(issue => issue.fieldIds.push(id));
      const dataType = definition?.dataType || 'text';
      const occurrences = candidates.map((field, index) => {
        occurrenceIds.set(field, `${id}/occurrence-${index + 1}`);
        const format = report.formats.get(field);
        const edit = session.edits?.get(field);
        return { id: `${id}/occurrence-${index + 1}`, originalValue: edit ? edit.originalValue : field.value,
          currentValue: field.value, formattedValue: format?.value ?? field.value,
          format: format ? { ...format } : null, source: sourceRange(field),
          origin: edit ? 'employee_entered' : 'parsed', corrections: edit?.changes || [] };
      });
      const answer = resolveAnswers(candidates, report.formats);
      const conflict = answer.conflict || issues.some(issue => issue.code === 'conflict');
      // Repeated singleton sections have no established unique subject, even
      // when their strings match. Preserve each scope rather than combining it.
      const ambiguousScope = definition && !definition.record && entries.filter(item => item.section === section && item.node.title === node.title).length > 1;
      const formatted = answer.value;
      let value = formatted, precision = null;
      let valueStatus = isMissing(formatted) ? 'missing' : definition ? 'value' : 'uninterpreted';
      if (occurrences.some(item => item.format?.error)) { valueStatus = 'invalid'; value = null; }
      else if (valueStatus !== 'missing' && dataType === 'date') {
        const date = parseCalendarDate(String(formatted));
        if (!date) { valueStatus = 'invalid'; value = null; }
        else {
          precision = date.precision;
          value = `${date.year}-${String(date.month).padStart(2, '0')}` + (precision === 'day' ? `-${String(date.day).padStart(2, '0')}` : '');
        }
      } else if (valueStatus !== 'missing' && dataType === 'boolean') {
        if (/^(yes|true|no|false)$/i.test(String(formatted).trim())) value = /^(yes|true)$/i.test(String(formatted).trim());
        else { valueStatus = 'ambiguous'; value = null; }
      }
      if (valueStatus === 'missing') value = null;
      if (ambiguousScope) { valueStatus = 'ambiguous'; value = null; }
      if (conflict) { valueStatus = 'conflict'; value = null; }
      const relatedReviews = reviewItems.filter(item => {
        if (item.message === 'Receiving income') return section === 'FINANCIAL SUPPORT' && incomeFields.includes(label);
        if (item.message === 'More Than 10 Conditions') return numbered;
        if (item.message.startsWith('Failed Work Attempt')) return definitionId === 'disability.onset-date-of-disability'
          || section === 'WORK HISTORY' && ['Start Date', 'End Date'].includes(label) && overlap(scope.source, item.range);
        return occurrences.some(occurrence => overlap(occurrence.source, item.range));
      });
      relatedReviews.forEach(item => item.fieldIds.push(id));
      const field = { id, definitionId, scopeId: scope.id, recordId: numbered ? `${scope.id}/${encodeURIComponent(label)}` : definition?.record ? scope.id : null,
        category: definition?.category || 'unmapped', label, dataType, supported: !!definition,
        ...(['priorSpouses', 'jobs'].includes(definition?.category) ? { recordSource: scope.source } : {}),
        parsed: occurrences.some(item => item.source), value, valueStatus, precision, occurrences,
        origin: occurrences.some(item => item.origin === 'employee_entered') ? 'employee_entered' : candidates.length ? 'parsed' : 'absent',
        validation: { issueIds: issues.map(issue => issue.id), unresolvedIssueIds: issues.filter(issue => !issue.dismissed).map(issue => issue.id),
          dismissedIssueIds: issues.filter(issue => issue.dismissed).map(issue => issue.id),
          hasErrors: issues.some(issue => issue.severity === 'error') },
        review: { itemIds: relatedReviews.map(item => item.id), reviewedIds: relatedReviews.filter(item => item.reviewed).map(item => item.id) } };
      fields.push(field); scope.fieldIds.push(id);
    }
    scope.occurrenceIds = node.fields.map(field => occurrenceIds.get(field));
  }
  for (const entry of entries) {
    const definitions = fieldDefinitions.filter(definition => definition.record ? entry.recordTypes.includes(definition.category)
      : entry.node.title === definition.section || schoolFallback && entry.node.title === definition.parent);
    buildScope(entry, definitions);
  }
  // Absent fixed fields are explicit. Never invent a provider, child, job or other record.
  for (const section of new Set(fieldDefinitions.filter(definition => !definition.record).map(definition => definition.section))) {
    const definitions = fieldDefinitions.filter(definition => !definition.record && definition.section === section);
    if (entries.some(entry => entry.node.title === section || schoolFallback && entry.node.title === definitions[0].parent)) continue;
    buildScope({ id: `scope/${encodeURIComponent(section)}~1`, path: null, section,
      node: { title: section, fields: [] } }, definitions, true);
  }
  const original = intakeSource(parsed);
  const unparsed = parsed.unparsed.map((item, index) => ({ ...item, id: `unparsed-${index}`, source: sourceRange(item),
    scopeId: entries.find(entry => entry.node === unparsedScope(item))?.id || null,
    issueIds: validationIssues.filter(issue => issue.code === 'parsing' && issue.line === item.line).map(issue => issue.id) }));
  const snapshot = {
    schema: CLIENT_DATA_SCHEMA, schemaVersion: CLIENT_DATA_VERSION, toolVersion: INTAKE_CHECKER_VERSION,
    revision: session.revision || 0,
    validationPerformed: session.validationPerformed !== false,
    source: { kind: 'delorean-text', text: original?.text ?? null, documentHeaderRange: original?.documentHeaderRange ?? null },
    scopes, fields, validationIssues, reviewItems, unparsed, deferred: [...report.deferred],
    derived: { purpose: 'Existing Checker display summaries; not independently validated answers.',
      summary: summarizeIntake(parsed), reviewIdentifier: review.identifier, reviewEmail: review.email,
      distinctMedicalProblemCount: distinctMedicalProblemCount(parsed),
      dependencies: {
        reviewIdentifier: fields.filter(field => ['personal.first-name', 'personal.last-name', 'personal.social-security-number'].includes(field.definitionId)).map(field => field.id),
        reviewEmail: fields.filter(field => field.definitionId === 'personal.email').map(field => field.id),
        medicalProblemCount: fields.filter(field => field.definitionId === 'medical-problems.problem').map(field => field.id),
        summaryScopes: scopes.filter(scope => scope.parsed).map(scope => scope.id)
      } },
    coverage: { fixedDefinitions: fieldDefinitions.length, parsedScopes: entries.length,
      parsedOccurrences: fields.reduce((sum, field) => sum + field.occurrences.filter(item => item.source).length, 0),
      currentOccurrences: entries.reduce((sum, entry) => sum + entry.node.fields.length, 0),
      preservedOccurrences: fields.reduce((sum, field) => sum + field.occurrences.length, 0),
      representedDefinitions: new Set(fields.filter(field => field.supported).map(field => field.definitionId)).size,
      fields: fields.length, unmappedFields: fields.filter(field => !field.supported).length,
      unparsedLines: unparsed.length }
  };
  return JSON.parse(JSON.stringify(snapshot));
}
