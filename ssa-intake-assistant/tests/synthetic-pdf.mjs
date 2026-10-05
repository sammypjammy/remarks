export function syntheticPdf() {
  const lines = [
    'First Name: Example', 'Last Name: Sample', 'Social Security Number: 000-12-3456',
    'Date of Birth: 1/1/2000', 'Phone Number: (210) 555-0142',
    'Mailing Address - Street Address: 1 Example Road', 'Mailing Address - City: Sampletown',
    'Mailing Address - State: TX', 'Mailing Address - ZIP Code: 00000',
  ];
  const text = `BT /F1 12 Tf 50 750 Td ${lines.map((line, index) => `${index ? '0 -20 Td ' : ''}(${line}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { output += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  output += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
