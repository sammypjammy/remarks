import { CLIENT_DATA_SCHEMA, CLIENT_DATA_VERSION } from '../../../intake-checker/client-data.js';
import { mappings, schemaVersion, childDefinitionIds } from '../../extension-dev/mapping.js';

// Only these exact, fictional practice questions can receive Checker answers.
// This projection never contains the original intake, sources, review notes or edits.
export function canonicalPracticeProfile(data) {
  const empty = { schema: 'packard.intake-client-profile', schemaVersion, fields: [] };
  if (data?.schema !== CLIENT_DATA_SCHEMA || data.schemaVersion !== CLIENT_DATA_VERSION
      || !data.validationPerformed || !Array.isArray(data.fields) || !Array.isArray(data.scopes)
      || !Array.isArray(data.validationIssues) || !Array.isArray(data.reviewItems)
      || data.validationIssues.some(issue => !issue.dismissed)
      || data.reviewItems.some(item => !item.reviewed)) return empty;

  const eligible = (field, type, precision = 'day') => field?.supported && field.dataType === type
    && field.valueStatus === 'value'
    && (type === 'boolean' ? typeof field.value === 'boolean'
      : typeof field.value === 'string' && !!field.value.trim() && field.value.length <= 500)
    && field.validation?.hasErrors === false && Array.isArray(field.validation?.unresolvedIssueIds)
    && !field.validation.unresolvedIssueIds.length
    && (type !== 'date' || ['day', 'month'].includes(field.precision)
      && (precision !== 'day' || field.precision === 'day'));
  const spouseScopes = data.scopes.filter(scope => scope.title === 'Current Spouse' && scope.recordTypes?.includes('spouse'));
  for (const mapping of mappings) {
    if (!mapping.definitionId) continue;
    const candidates = data.fields.filter(field => field.definitionId === mapping.definitionId);
    if (candidates.length !== 1) continue;
    const field = candidates[0];
    if (mapping.recordCategory === 'spouse'
      ? spouseScopes.length !== 1 || field.recordId !== spouseScopes[0].id
      : field.recordId !== null) continue;
    if (!eligible(field, mapping.type, mapping.precision)) continue;
    const recordId = mapping.recordCategory === 'spouse' ? 'current-spouse' : null;
    empty.fields.push({ id: recordId ? `${mapping.definitionId}@${recordId}` : mapping.definitionId,
      definitionId: mapping.definitionId, recordId, dataType: mapping.type, value: field.value,
      precision: field.precision || null, readiness: 'ready', blockingReasons: [] });
  }
  const childScopes = data.scopes.filter(scope => scope.recordTypes?.includes('children'));
  for (const [index, scope] of childScopes.slice(0, 30).entries()) {
    const recordId = `child-${index + 1}`;
    for (const definitionId of childDefinitionIds) {
      const candidates = data.fields.filter(field => field.definitionId === definitionId && field.recordId === scope.id);
      if (candidates.length !== 1 || !eligible(candidates[0], 'text')) continue;
      empty.fields.push({ id: `${definitionId}@${recordId}`, definitionId, recordId,
        dataType: 'text', value: candidates[0].value, precision: null, readiness: 'ready', blockingReasons: [] });
    }
  }
  return empty;
}
