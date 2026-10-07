import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { unzipSync, zipSync } from 'fflate';
import { splitContract, SPLITS } from '../contract-splitter/splits.js';

async function fixture(count) {
  const pdf = await PDFDocument.create();
  for (let page = 1; page <= count; page++) {
    pdf.addPage([200 + page, 300 + page]);
  }
  return pdf.save();
}

test('all four outputs preserve the exact source pages', async () => {
  const source = await fixture(12);
  const { results } = await splitContract(source);
  assert.equal(results.length, 4);
  for (const { range, bytes, missing } of results) {
    assert.equal(missing, undefined);
    const output = await PDFDocument.load(bytes);
    assert.equal(output.getPageCount(), range.end - range.start + 1);
    output.getPages().forEach((page, index) => {
      assert.equal(page.getWidth(), 200 + range.start + index);
      assert.equal(page.getHeight(), 300 + range.start + index);
    });
  }
  const zipped = unzipSync(zipSync(Object.fromEntries(results.map((item, i) => [`${i}.pdf`, item.bytes]))));
  assert.equal(Object.keys(zipped).length, SPLITS.length);
  for (const bytes of Object.values(zipped)) await PDFDocument.load(bytes);
});

test('short PDFs skip incomplete ranges without partial output', async () => {
  const { results } = await splitContract(await fixture(6));
  assert.ok(results[0].bytes);
  assert.equal(results.slice(1).filter(item => item.missing).length, 3);
});

test('multiple contracts yield independent outputs', async () => {
  const inputs = await Promise.all([fixture(11), fixture(3)]);
  const outputs = await Promise.all(inputs.map(splitContract));
  assert.equal(outputs[0].results.filter(item => item.bytes).length, 4);
  assert.equal(outputs[1].results.filter(item => item.bytes).length, 0);
});
