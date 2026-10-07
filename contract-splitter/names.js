export function documentName(sourceName, selection) {
  const base = sourceName.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'contract';
  const pages = selection.replace(/\s*-\s*/g, '-').replace(/\s*,\s*/g, ', ').trim();
  return `${base} ${pages}.pdf`;
}

export function uniqueDocumentName(name, used) {
  let candidate = name;
  let copy = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = name.replace(/\.pdf$/i, ` (${copy++}).pdf`);
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
