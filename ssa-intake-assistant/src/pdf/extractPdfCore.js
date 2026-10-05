import * as pdfjs from 'pdfjs-dist';
import { createLocalOcrWorker, recognizePdfPage } from './ocrPdfPage.js';
import { groupItemsIntoLines } from './layoutText.js';

export async function extractPdfPages(file, { useOcr = false, onProgress = () => {} } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = [];
  const formFields = [];
  let textItemCount = 0;
  let ocrWorker = null;
  let ocrPageCount = 0;
  let currentOcrPage = 0;

  if (useOcr) {
    onProgress({ stage: 'ocr_loading', pageNumber: 0, pageCount: pdf.numPages, progress: 0 });
    ocrWorker = await createLocalOcrWorker(({ status, progress }) => {
      onProgress({ stage: status, pageNumber: currentOcrPage, pageCount: pdf.numPages, progress });
    });
  }

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const annotations = await page.getAnnotations({ intent: 'display' });
      textItemCount += content.items.filter((item) => item.str?.trim()).length;
      const lines = groupItemsIntoLines(content.items);

      if (ocrWorker) {
        currentOcrPage = pageNumber;
        onProgress({ stage: 'ocr_page', pageNumber, pageCount: pdf.numPages, progress: 0 });
        const ocr = await recognizePdfPage(page, ocrWorker);
        if (ocr.text) {
          lines.push(...ocr.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
          ocrPageCount += 1;
        }
      }
      pages.push({ pageNumber, text: lines.join('\n'), ocrUsed: Boolean(ocrWorker) });

      for (const annotation of annotations) {
        const value = readableFieldValue(annotation.fieldValue ?? annotation.buttonValue);
        const label = annotation.alternativeText || annotation.fieldName;
        if (!label || !value) continue;
        formFields.push({ label, value, pageNumber });
      }
    }
  } finally {
    if (ocrWorker) await ocrWorker.terminate();
    await pdf.destroy();
  }
  return {
    pages,
    formFields,
    diagnostics: {
      pageCount: pages.length,
      textItemCount,
      completedFormFieldCount: formFields.length,
      ocrUsed: useOcr,
      ocrPageCount,
      hasExtractableContent: textItemCount > 0 || formFields.length > 0 || ocrPageCount > 0,
    },
  };
}

function readableFieldValue(value) {
  if (Array.isArray(value)) return value.map(readableFieldValue).filter(Boolean).join(', ');
  if (value == null || value === false) return '';
  const cleaned = String(value).trim();
  if (!cleaned || /^(off|unchecked)$/i.test(cleaned)) return '';
  return cleaned;
}
