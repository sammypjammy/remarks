import { CLIENT_DATA_SCHEMA, CLIENT_DATA_VERSION } from '../../../intake-checker/client-data.js';

const SSN_DEFINITION_ID = 'personal.social-security-number';

export function readySocialSecurityNumber(data) {
  if (data?.schema !== CLIENT_DATA_SCHEMA || data.schemaVersion !== CLIENT_DATA_VERSION
      || data.validationPerformed !== true || !Array.isArray(data.fields)) return null;
  const matches = data.fields.filter(field => field.definitionId === SSN_DEFINITION_ID);
  if (matches.length !== 1) return null;
  const field = matches[0];
  if (!field.supported || field.recordId !== null || field.dataType !== 'text'
      || field.valueStatus !== 'value' || typeof field.value !== 'string'
      || !/^\d{3}-\d{2}-\d{4}$/.test(field.value)
      || field.validation?.hasErrors !== false
      || !Array.isArray(field.validation?.unresolvedIssueIds) || field.validation.unresolvedIssueIds.length
      || !Array.isArray(field.review?.itemIds) || !Array.isArray(field.review?.reviewedIds)
      || field.review.itemIds.some(id => !field.review.reviewedIds.includes(id))) return null;
  return field.value;
}
