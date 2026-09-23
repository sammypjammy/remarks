import { mkdir, writeFile } from 'node:fs/promises';
import { productionCheck } from './validate.mjs';

// Remote build only. Validate before producing any deployable artifact.
const result = productionCheck(process.env);
if (result !== 'PASS') {
  console.log(`FAIL ${result}`);
  process.exitCode = 1;
} else {
  try {
    await mkdir('public', { recursive: true });
    await writeFile('public/index.html', '<!doctype html><html lang="en"><meta charset="utf-8"><title>Maintenance</title><p>Maintenance artifact.</p></html>\n');
    console.log('PASS');
  } catch {
    console.log('FAIL BUILD_OUTPUT_FAILED');
    process.exitCode = 1;
  }
}
