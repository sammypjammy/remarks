import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfPages } from './extractPdfCore.js';
import { parseIntakePages } from './parseIntake.js';
import { syntheticPdf } from '../../tests/synthetic-pdf.mjs';

test('extracts synthetic PDF text locally with page provenance', async () => {
  const result = await extractPdfPages(new Blob([syntheticPdf()], { type: 'application/pdf' }));
  assert.equal(result.pages.length, 1);
  assert(result.diagnostics.textItemCount > 0);
  const profile = parseIntakePages(result.pages, 'synthetic.pdf', result.formFields, result.diagnostics);
  assert.equal(profile.personal.firstName.value, 'Example');
  assert.equal(profile.personal.lastName.value, 'Sample');
  assert.equal(profile.personal.firstName.sourcePage, 1);
});
