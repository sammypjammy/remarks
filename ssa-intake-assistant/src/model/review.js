import { profileCanBeMarkedReady } from './validation.js';

export const phaseOneRequiredPaths = Object.freeze([
  'personal.firstName', 'personal.lastName', 'personal.ssn', 'personal.dateOfBirth',
  'contact.phone', 'contact.mailingAddress.street1', 'contact.mailingAddress.city',
  'contact.mailingAddress.state', 'contact.mailingAddress.zip',
]);

export function getField(profile, path) {
  return path.split('.').reduce((current, key) => current?.[key], profile);
}

export function editAnswer(profile, path, value) {
  const next = structuredClone(profile);
  const field = getField(next, path);
  if (!field) throw new Error('Unknown profile field');
  Object.assign(field, {
    value,
    status: value.trim() ? 'needs_review' : 'missing',
    employeeConfirmed: false,
    confidence: value.trim() ? 1 : 0,
    notes: value.trim() ? 'Edited by employee.' : '',
  });
  next.ready = false;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function confirmAnswer(profile, path, confirmed) {
  const next = structuredClone(profile);
  const field = getField(next, path);
  if (!field || (confirmed && !String(field.value).trim())) return profile;
  field.employeeConfirmed = confirmed;
  field.status = confirmed ? 'confirmed' : 'needs_review';
  if (confirmed) field.confidence = 1;
  next.ready = false;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function markProfileReady(profile) {
  if (!profileCanBeMarkedReady(profile, phaseOneRequiredPaths)) return profile;
  return { ...profile, ready: true, updatedAt: new Date().toISOString() };
}
