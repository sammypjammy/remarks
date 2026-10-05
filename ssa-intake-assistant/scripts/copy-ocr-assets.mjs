import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(appRoot, 'public', 'ocr');
const dependencyRoot = join(appRoot, '..', 'node_modules');
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core.wasm.js', 'tesseract-core.wasm.js'],
  ['tesseract.js-core/tesseract-core.wasm', 'tesseract-core.wasm'],
  ['tesseract.js-core/tesseract-core-simd.wasm.js', 'tesseract-core-simd.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd.wasm', 'tesseract-core-simd.wasm'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

await mkdir(destination, { recursive: true });
await Promise.all(
  files.map(([source, name]) => copyFile(join(dependencyRoot, source), join(destination, name))),
);

