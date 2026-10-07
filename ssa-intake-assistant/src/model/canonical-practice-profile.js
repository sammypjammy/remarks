import { CLIENT_DATA_SCHEMA, CLIENT_DATA_VERSION } from '../../../intake-checker/client-data.js';
import { mappings, schemaVersion } from '../../extension-dev/mapping.js';

// Only these exact, fictional practice questions can receive Checker answers.
// This projection never contains the original intake, sources, review notes or edits.
export function canonicalPracticeProfile(data) {
  const empty = { schema: 'packard.intake-client-profile', schemaVersion, fields: [] };
  if (data?.schema !== CLIENT_DATA_SCHEMA || data.schemaVersion !== CLIENT_DATA_VERSION
      || !data.validationPerformed || !Array.isArray(data.fields)
      || !Array.isArray(data.validationIssues) || !Array.isArray(data.reviewItems)
      || data.validationIssues.some(issue => !issue.dismissed)
      || data.reviewItems.some(item => !item.reviewed)) return empty;

  for (const mapping of mappings) {
    if (!mapping.definitionId) continue;
    const candidates = data.fields.filter(field => field.definitionId === mapping.definitionId);
    if (candidates.length !== 1) continue;
    const field = candidates[0];
    if (!field.supported || field.recordId !== null || field.dataType !== mapping.type
        || field.valueStatus !== 'value' || typeof field.value !== 'string'
        || !field.value.trim() || field.value.length > 500
        || field.validation?.hasErrors !== false || !Array.isArray(field.validation?.unresolvedIssueIds)
        || field.validation.unresolvedIssueIds.length
        || (mapping.type === 'date' && (field.precision !== 'day' && field.precision !== 'month'
          || mapping.precision === 'day' && field.precision !== 'day'))) continue;
    empty.fields.push({ id: mapping.definitionId, definitionId: mapping.definitionId,
      recordId: null, dataType: mapping.type, value: field.value,
      precision: field.precision || null, readiness: 'ready', blockingReasons: [] });
  }
  return empty;
}
