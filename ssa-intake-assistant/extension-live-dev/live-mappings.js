// Add entries only after a live question's meaning and selector are verified.
// Practice-page selectors are not live SSA selectors.
export const LIVE_PAGE_MAPPINGS = Object.freeze([]);
export const PROFILE_SCHEMA = 'packard.intake-client-profile';
export const PROFILE_VERSION = '3.5.0';
export const RESERVED_TARGETS = Object.freeze([
  'saved-application-ssn', 're-entry-number', 'reentry-number', 'login', 'password', 'mfa',
  'captcha', 'attestation', 'signature', 'final-submission',
]);

// A future, explicitly approved receiver may call this after it binds one SSA
// tab. This module neither receives nor stores a profile and never touches DOM.
export function planLiveFields(profile, pageKey) {
  if (profile?.schema !== PROFILE_SCHEMA || profile.schemaVersion !== PROFILE_VERSION
      || !Array.isArray(profile.fields) || typeof pageKey !== 'string') return [];
  return LIVE_PAGE_MAPPINGS.filter(mapping => mapping.pageKey === pageKey && !RESERVED_TARGETS.includes(mapping.target))
    .flatMap(mapping => {
      const matches = profile.fields.filter(field => field.definitionId === mapping.definitionId
        && field.recordId === (mapping.recordId ?? null));
      if (matches.length !== 1) return [];
      const field = matches[0];
      if (field.readiness !== 'ready' || field.blockingReasons?.length !== 0 || field.dataType !== mapping.dataType
          || field.value === null || field.value === undefined) return [];
      return [{ target: mapping.target, fieldId: field.id, value: field.value }];
    });
}
