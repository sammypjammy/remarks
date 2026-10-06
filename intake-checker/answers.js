import { isMissing } from './values.js';

// Compare only the same label and subject. Never merge records by name.
// Approved format normalization is shared with validation; raw sources stay intact.
export function resolveAnswers(fields, formats) {
  const keys = fields.map(field => {
    if (isMissing(field.value)) return JSON.stringify(['missing']);
    const format = formats?.get(field);
    return JSON.stringify([format?.error ? 'invalid' : 'value', String(format?.value ?? field.value).trim()]);
  });
  const conflict = new Set(keys).size > 1;
  const first = fields[0];
  return {
    fields, conflict,
    field: !conflict && first && !isMissing(first.value) ? first : null,
    value: conflict || !first || isMissing(first.value) ? null : formats?.get(first)?.value ?? first.value,
  };
}
