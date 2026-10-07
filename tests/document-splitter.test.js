import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { unzipSync, zipSync } from 'fflate';
import { splitContract, INTAKE_CONTRACT_PIECES, makeSplits, parsePageSelection } from '../document-splitter/splits.js';
import { documentName, uniqueDocumentName } from '../document-splitter/names.js';

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
    assert.equal(output.getPageCount(), range.pages.length);
    output.getPages().forEach((page, index) => {
      assert.equal(page.getWidth(), 200 + range.pages[index]);
      assert.equal(page.getHeight(), 300 + range.pages[index]);
    });
  }
  const zipped = unzipSync(zipSync(Object.fromEntries(results.map((item, i) => [`${i}.pdf`, item.bytes]))));
  assert.equal(Object.keys(zipped).length, INTAKE_CONTRACT_PIECES.length);
  for (const bytes of Object.values(zipped)) await PDFDocument.load(bytes);
});

test('short PDFs skip incomplete ranges without partial output', async () => {
  const { results } = await splitContract(await fixture(6));
  assert.ok(results[0].bytes);
  assert.equal(results.slice(1).filter(item => item.missing).length, 3);
});

test('multiple contracts yield independent outputs', async () => {
  const inputs = await Promise.all([fixture(11), fixture(3)]);
  const outputs = await Promise.all(inputs.map(bytes => splitContract(bytes)));
  assert.equal(outputs[0].results.filter(item => item.bytes).length, 4);
  assert.equal(outputs[1].results.filter(item => item.bytes).length, 0);
});

test('custom pieces preserve selected page order and exact pages', async () => {
  const splits = makeSplits(['1-3, 8, 5', '11']);
  const { results } = await splitContract(await fixture(12), splits);
  const first = await PDFDocument.load(results[0].bytes);
  assert.deepEqual(first.getPages().map(page => page.getWidth()), [201, 202, 203, 208, 205]);
  const second = await PDFDocument.load(results[1].bytes);
  assert.deepEqual(second.getPages().map(page => page.getWidth()), [211]);
});

test('custom pieces report missing pages and reject invalid selections', async () => {
  const { results } = await splitContract(await fixture(6), makeSplits(['2, 7, 10', '3-4']));
  assert.deepEqual(results[0].missingPages, [7, 10]);
  assert.equal(results[0].bytes, undefined);
  assert.ok(results[1].bytes);
  for (const invalid of ['', '0', '3-1', '1,,3', '1, 1', '2-x']) {
    assert.throws(() => parsePageSelection(invalid));
  }
});

test('downloads use the source name and selected pages without collisions', () => {
  assert.equal(documentName('DocumentName.pdf', '1-4'), 'DocumentName 1-4.pdf');
  assert.equal(documentName('DocumentName.pdf', '10'), 'DocumentName 10.pdf');
  assert.equal(documentName('DocumentName.pdf', '1 - 4,7, 10'), 'DocumentName 1-4, 7, 10.pdf');
  assert.equal(documentName('DocumentName.pdf', '1-4', '1696'), 'DocumentName 1696.pdf');
  assert.equal(documentName('DocumentName.pdf', '1-4', 'Medical/Records'), 'DocumentName Medical_Records.pdf');
  const used = new Set();
  assert.equal(uniqueDocumentName('DocumentName 1-4.pdf', used), 'DocumentName 1-4.pdf');
  assert.equal(uniqueDocumentName('DocumentName 1-4.pdf', used), 'DocumentName 1-4 (2).pdf');
});

test('Intake Contracts preset maps each page selection to its output name', async () => {
  const expected = [
    ['1-4', '1696'], ['5-7', '1693'], ['10', '3288'], ['11', '827']
  ];
  assert.deepEqual(INTAKE_CONTRACT_PIECES.map(({ selection, name }) => [selection, name]), expected);
  const { results } = await splitContract(await fixture(11), makeSplits(INTAKE_CONTRACT_PIECES));
  assert.deepEqual(results.map(({ range }) => documentName('Client.pdf', range.selection, range.name)),
    ['Client 1696.pdf', 'Client 1693.pdf', 'Client 3288.pdf', 'Client 827.pdf']);
});

test('Other pieces can use distinct names or fall back to page selections', () => {
  const ranges = makeSplits([{ selection: '2-3', name: 'First' }, { selection: '8', name: '' }]);
  assert.equal(documentName('File.pdf', ranges[0].selection, ranges[0].name), 'File First.pdf');
  assert.equal(documentName('File.pdf', ranges[1].selection, ranges[1].name), 'File 8.pdf');
});
