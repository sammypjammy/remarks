import { FIELD_STATUSES, isField } from './client-schema.js';

const MISSING_MARKERS = new Set([
  '',
  'not provided',
  'n/a',
  'na',
  'none provided',
  'not',
  'provided',
  'unknown',
]);

export function cleanExtractedValue(value) {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim();
  return MISSING_MARKERS.has(cleaned.toLowerCase()) ? '' : cleaned;
}

export function isImpossibleDate(value) {
  const cleaned = cleanExtractedValue(value);
  if (!cleaned) return true;
  if (/-(?:0{3,4}|\d{5,})\b/.test(cleaned)) return true;

  const match = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](-?\d{1,4})$/);
  if (!match) return false;
  const [, month, day, year] = match.map(Number);
  if (year < 1900 || year > new Date().getFullYear()) return true;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  );
}

export function normalizeExtractedValue(value, kind = 'text') {
  const cleaned = cleanExtractedValue(value);
  if (kind === 'date' && isImpossibleDate(cleaned)) return '';
  return cleaned;
}

export function validateProfile(profile) {
  const errors = [];
  const visit = (node, path = '') => {
    if (isField(node)) {
      if (!FIELD_STATUSES.includes(node.status)) errors.push(`${path}: invalid status`);
      if (node.confidence < 0 || node.confidence > 1) errors.push(`${path}: confidence must be 0–1`);
      return;
    }
    if (Array.isArray(node)) return node.forEach((item, index) => visit(item, `${path}[${index}]`));
    if (node && typeof node === 'object') {
      Object.entries(node).forEach(([key, value]) => visit(value, path ? `${path}.${key}` : key));
    }
  };
  visit(profile);
  return errors;
}

export function profileCanBeMarkedReady(profile, requiredPaths) {
  return requiredPaths.every((path) => {
    const field = path.split('.').reduce((value, key) => value?.[key], profile);
    return isField(field) && field.status === 'confirmed' && field.employeeConfirmed;
  });
}
