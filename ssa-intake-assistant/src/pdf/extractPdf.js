import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractPdfPages } from './extractPdfCore.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { extractPdfPages };
