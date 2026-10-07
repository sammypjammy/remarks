import { PDFDocument } from 'pdf-lib';

// Inclusive, one-based page ranges. Change this list to update every output.
export const SPLITS = Object.freeze([
  Object.freeze({ label: 'Pages 1–4', suffix: 'pages-1-4', start: 1, end: 4 }),
  Object.freeze({ label: 'Pages 5–7', suffix: 'pages-5-7', start: 5, end: 7 }),
  Object.freeze({ label: 'Page 10', suffix: 'page-10', start: 10, end: 10 }),
  Object.freeze({ label: 'Page 11', suffix: 'page-11', start: 11, end: 11 })
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

export function makeSplits(selections) {
  return selections.map((selection, index) => {
    const pages = parsePageSelection(selection);
    return { label: `Piece ${index + 1} · pages ${selection.trim()}`, selection: selection.trim(), pages };
  });
}

export async function splitContract(bytes, splits = SPLITS) {
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const results = [];
  for (const range of splits) {
    const selectedPages = range.pages || Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i);
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
