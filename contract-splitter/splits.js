import { PDFDocument } from 'pdf-lib';

// Inclusive, one-based page ranges. Change this list to update every output.
export const SPLITS = Object.freeze([
  Object.freeze({ label: 'Pages 1–4', suffix: 'pages-1-4', start: 1, end: 4 }),
  Object.freeze({ label: 'Pages 5–7', suffix: 'pages-5-7', start: 5, end: 7 }),
  Object.freeze({ label: 'Page 10', suffix: 'page-10', start: 10, end: 10 }),
  Object.freeze({ label: 'Page 11', suffix: 'page-11', start: 11, end: 11 })
]);

export async function splitContract(bytes) {
  const source = await PDFDocument.load(bytes);
  const pageCount = source.getPageCount();
  const results = [];
  for (const range of SPLITS) {
    if (pageCount < range.end) {
      results.push({ range, missing: true });
      continue;
    }
    const output = await PDFDocument.create();
    const indexes = Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i - 1);
    const pages = await output.copyPages(source, indexes);
    pages.forEach(page => output.addPage(page));
    results.push({ range, bytes: await output.save() });
  }
  return { pageCount, results };
}
