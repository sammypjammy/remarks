// Compatibility projection metadata; Intake Checker owns all field definitions.
export { fieldDefinitions, medicalProblemDefinition, FIELD_TYPES } from '../../../intake-checker/field-catalog.js';
export const PROFILE_SCHEMA_VERSION = '3.1.0';
export function profileSummary(profile) {
  const fields = profile.fields;
  return {
    total: fields.length,
    received: fields.filter(field => field.sources.length > 0).length,
    ready: fields.filter(field => field.readiness === 'ready').length,
    blocked: fields.filter(field => field.readiness === 'blocked').length,
    missing: fields.filter(field => field.blockingReasons.some(reason => reason.code === 'missing')).length,
    conflicts: fields.filter(field => field.blockingReasons.some(reason => reason.code === 'conflict')).length,
  };
}

// Future consumers must also require an exact SSA question/definition mapping.
// Returning ready fields is a local projection, not an extension connection.
export function readyFields(profile) {
  if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION) return [];
  return profile.fields.filter(field => field.readiness === 'ready' && field.blockingReasons.length === 0 && field.value !== null);
}
