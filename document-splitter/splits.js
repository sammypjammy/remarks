import { PDFDocument } from 'pdf-lib';

// Inclusive, one-based pages. This is the single source of truth for the preset.
export const INTAKE_CONTRACT_PIECES = Object.freeze([
  Object.freeze({ name: '1696', selection: '1-4' }),
  Object.freeze({ name: '1693', selection: '5-7' }),
  Object.freeze({ name: '3288', selection: '10' }),
  Object.freeze({ name: '827', selection: '11' })
]);

export function parsePageSelection(value) {
  const parts = value.split(',').map(part => part.trim());
  if (!parts.length || parts.some(part => !/^[1-9]\d*(?:\s*-\s*[1-9]\d*)?$/.test(part))) {
    throw new Error('Use page numbers or ranges, such as 1-4, 7, 10-12.');
  }
  const pages = [];
  for (const part of parts) {
    const [start, end = start] = part.split(/\s*-\s*/).map(Number);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start > 9999) {
      throw new Error('Check the page numbers and range order.');
    }
    for (let page = start; page <= end; page++) pages.push(page);
  }
  if (new Set(pages).size !== pages.length) throw new Error('Each page can appear only once in a piece.');
  return pages;
}

export function makeSplits(pieces) {
  return pieces.map((piece, index) => {
    const { selection, name = '' } = typeof piece === 'string' ? { selection: piece } : piece;
    const pages = parsePageSelection(selection);
    const displayName = name.trim() || `Piece ${index + 1}`;
    return { label: `${displayName} · pages ${selection.trim()}`, name: name.trim(), selection: selection.trim(), pages };
  });
}

export async function splitContract(bytes, splits = makeSplits(INTAKE_CONTRACT_PIECES)) {
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const results = [];
  for (const range of splits) {
    const selectedPages = range.pages;
    const missingPages = selectedPages.filter(page => page > pageCount);
    if (missingPages.length) {
      results.push({ range, missing: true, missingPages });
      continue;
    }
    const output = await PDFDocument.create();
    const pages = await output.copyPages(source, selectedPages.map(page => page - 1));
    pages.forEach(page => output.addPage(page));
    results.push({ range, bytes: await output.save() });
  }
  return { pageCount, results };
}
