import { zipSync } from "fflate";
import { saveReceiptBlob } from "./message.js";

export async function downloadReceiptZip(receipts) {
  const files = Object.create(null);
  for (const { filename, blob } of receipts) {
    // Same-named source documents can exist. Preserve both original filenames
    // in separate directories rather than overwriting one ZIP entry.
    let path = filename;
    for (let index = 2; Object.hasOwn(files, path); index++) path = `${index}/${filename}`;
    files[path] = new Uint8Array(await blob.arrayBuffer());
  }
  saveReceiptBlob(new Blob([zipSync(files, { level: 0 })], { type: "application/zip" }), "Fax Receipts.zip");
}
