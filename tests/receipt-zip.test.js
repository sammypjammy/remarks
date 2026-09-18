import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { downloadReceiptZip } from "../fax-sender/receipts-zip.js";

test("ZIP fallback preserves PDF names and bytes, including duplicate source filenames", async t => {
  const originalDocument = globalThis.document;
  const originalUrl = URL.createObjectURL;
  const originalTimeout = globalThis.setTimeout;
  let archive, filename;
  globalThis.document = { createElement: () => ({ click() { filename = this.download; } }) };
  URL.createObjectURL = blob => { archive = blob; return "blob:test"; };
  globalThis.setTimeout = () => 1;
  t.after(() => { globalThis.document = originalDocument; URL.createObjectURL = originalUrl; globalThis.setTimeout = originalTimeout; });
  await downloadReceiptZip([
    { filename: "Fax Receipt - 827 2134.pdf", blob: new Blob(["%PDF-one"]) },
    { filename: "Fax Receipt - DIB DR 2134.pdf", blob: new Blob(["%PDF-two"]) },
    { filename: "Fax Receipt - 827 2134.pdf", blob: new Blob(["%PDF-three"]) }
  ]);
  assert.equal(filename, "Fax Receipts.zip");
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.deepEqual(Object.keys(files), ["Fax Receipt - 827 2134.pdf", "Fax Receipt - DIB DR 2134.pdf", "2/Fax Receipt - 827 2134.pdf"]);
  assert.deepEqual(Object.values(files).map(strFromU8), ["%PDF-one", "%PDF-two", "%PDF-three"]);
});
