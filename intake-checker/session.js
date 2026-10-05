import { validateIntake } from './validation.js';
import { reviewIntake } from './review.js';
import { createAcknowledgements } from './acknowledgements.js';
import { sourceRange } from './parser.js';

export function createIntakeSession(parsed) {
  const report = validateIntake(parsed);
  const review = reviewIntake(parsed);
  return { parsed, report, review, revision: 0, edits: new Map(),
    validationState: createAcknowledgements(report.issues), reviewState: createAcknowledgements(review.items) };
}

export function nodeAtPath(parsed, path) {
  let nodes = parsed.sections, node;
  for (const index of path.split('/').slice(1)) {
    node = nodes[Number(index)];
    if (!node) return null;
    nodes = node.subsections;
  }
  return node;
}

const signature = item => JSON.stringify(item);
function retainAcknowledgements(previousItems, previousState, nextItems, affected) {
  const remaining = previousState.remaining();
  const acknowledged = new Set(previousItems.filter(item => !remaining.includes(item) && !affected(item)).map(signature));
  const next = createAcknowledgements(nextItems);
  nextItems.filter(item => acknowledged.has(signature(item))).forEach(next.review);
  return next;
}

// Only the adapter's unambiguous correction targets reach this function.
// Keep the original pasted text and its offsets; the edit ledger records overrides.
export function correctIntakeField(session, target, value) {
  if (!target || typeof value !== 'string') return false;
  let node = target.nodePath ? nodeAtPath(session.parsed, target.nodePath) : null;
  if (!node && target.nodePath) return false;
  if (!node) {
    if (session.parsed.sections.some(item => item.title === target.section)) return false;
    node = { title: target.section, fields: [], subsections: [] };
    session.parsed.sections.push(node);
  }
  const matches = node.fields.filter(field => field.label === target.label);
  if (matches.length > 1) return false;
  let field = matches[0];
  if (!field) { field = { label: target.label, value: null }; node.fields.push(field); }
  const before = session.edits.get(field) || { originalValue: field.value, changes: [] };
  session.revision++;
  session.edits.set(field, { ...before, changes: [...before.changes, { revision: session.revision, value }] });
  field.value = value.trim() || null;
  const report = validateIntake(session.parsed);
  const review = reviewIntake(session.parsed);
  // Recheck same-scope dependent rules; don't carry old dismissals across a correction.
  const affected = issue => issue.location === target.nodePath || issue.section === target.section && !issue.location;
  const validationState = retainAcknowledgements(session.report.issues, session.validationState, report.issues, affected);
  // Review flags can depend on multiple fields/records: only unchanged unrelated flags survive.
  const reviewState = retainAcknowledgements(session.review.items, session.reviewState, review.items, item => {
    const ranges = [target.range, sourceRange(node)].filter(Boolean);
    if (item.range) return ranges.some(range => item.range.start === range.start && item.range.end === range.end);
    return item.message === 'Receiving income' && target.section === 'FINANCIAL SUPPORT'
      || item.message === 'More Than 10 Conditions' && target.section === 'MEDICAL PROBLEMS';
  });
  Object.assign(session, { report, review, validationState, reviewState });
  return true;
}
