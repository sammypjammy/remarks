// Synthetic format-valid answers only. No client records are used.
export function syntheticValue(label, fallback = 'No') {
  if (/Phone/.test(label)) return '202-555-0142';
  if (label === 'Social Security Number') return '000-12-3456';
  if (/Zipcode|Zip Code/.test(label)) return '00000';
  if (label === 'Email') return 'synthetic@example.test';
  if (/date/i.test(label) || label === 'When did you last work') return '2000-01-01';
  if (/Monthly amount/.test(label) || label === 'Rate of Pay') return '$10.00';
  return fallback;
}
