export function documentName(sourceName, selection, pieceName = '') {
  const base = sourceName.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'document';
  const pages = selection.replace(/\s*-\s*/g, '-').replace(/\s*,\s*/g, ', ').trim();
  const suffix = pieceName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || pages;
  return `${base} ${suffix}.pdf`;
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
