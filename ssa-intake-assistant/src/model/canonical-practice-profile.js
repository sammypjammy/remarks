import { CLIENT_DATA_SCHEMA, CLIENT_DATA_VERSION } from '../../../intake-checker/client-data.js';
import { mappings, schemaVersion, childDefinitionIds } from '../../extension-dev/mapping.js';

// Only these exact, fictional practice questions can receive Checker answers.
// This projection never contains the original intake, sources, review notes or edits.
export function canonicalPracticeProfile(data) {
  const empty = { schema: 'packard.intake-client-profile', schemaVersion, fields: [], priorSpouseRecords: [] };
  if (data?.schema !== CLIENT_DATA_SCHEMA || data.schemaVersion !== CLIENT_DATA_VERSION
      || !data.validationPerformed || !Array.isArray(data.fields) || !Array.isArray(data.scopes)
      || !Array.isArray(data.validationIssues) || !Array.isArray(data.reviewItems)
      || data.validationIssues.some(issue => !issue.dismissed)
      || data.reviewItems.some(item => !item.reviewed)) return empty;

  const eligible = (field, type, precision = 'day', allowedValues = null) => field?.supported && field.dataType === type
    && field.valueStatus === 'value'
    && (type === 'boolean' ? typeof field.value === 'boolean'
      : typeof field.value === 'string' && !!field.value.trim() && field.value.length <= 500)
    && field.validation?.hasErrors === false && Array.isArray(field.validation?.unresolvedIssueIds)
    && !field.validation.unresolvedIssueIds.length
    && (!allowedValues || allowedValues.includes(field.value))
    && (type !== 'date' || ['day', 'month'].includes(field.precision)
      && (precision !== 'day' || field.precision === 'day'));
  const spouseScopes = data.scopes.filter(scope => scope.title === 'Current Spouse' && scope.recordTypes?.includes('spouse')
    && data.fields.some(field => field.recordId === scope.id && field.parsed));
  const priorSpouseScopes = data.scopes.filter(scope => scope.recordTypes?.includes('priorSpouses') && scope.parsed);
  empty.priorSpouseRecords = priorSpouseScopes.map((_, index) => `prior-spouse-${index + 1}`);
  for (const mapping of mappings) {
    if (!mapping.definitionId) continue;
    if (mapping.recordCategory === 'priorSpouses') {
      for (const [index, scope] of priorSpouseScopes.entries()) {
        const candidates = data.fields.filter(field => field.definitionId === mapping.definitionId && field.recordId === scope.id);
        if (candidates.length !== 1 || !eligible(candidates[0], mapping.type, mapping.precision, mapping.allowedValues)) continue;
        const recordId = `prior-spouse-${index + 1}`;
        empty.fields.push({ id: `${mapping.definitionId}@${recordId}`, definitionId: mapping.definitionId,
          recordId, dataType: mapping.type, value: candidates[0].value, precision: candidates[0].precision || null,
          readiness: 'ready', blockingReasons: [] });
      }
      continue;
    }
    const recordId = mapping.recordCategory === 'spouse' ? spouseScopes.length === 1 ? spouseScopes[0].id : null : null;
    if (mapping.recordCategory === 'spouse' && !recordId) continue;
    const candidates = data.fields.filter(field => field.definitionId === mapping.definitionId && field.recordId === recordId);
    if (candidates.length !== 1) continue;
    const field = candidates[0];
    if (!eligible(field, mapping.type, mapping.precision, mapping.allowedValues)) continue;
    const projectedRecordId = mapping.recordCategory === 'spouse' ? 'current-spouse' : null;
    empty.fields.push({ id: projectedRecordId ? `${mapping.definitionId}@${projectedRecordId}` : mapping.definitionId,
      definitionId: mapping.definitionId, recordId: projectedRecordId, dataType: mapping.type, value: field.value,
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
