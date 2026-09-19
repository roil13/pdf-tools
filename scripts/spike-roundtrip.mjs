// Q7: does a pdf-lib load + untouched re-save damage outlines or AcroForm?
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

for (const name of ['outlined-form', 'plain']) {
  const src = `test/fixtures/${name}.pdf`;
  const doc = await PDFDocument.load(readFileSync(src));
  const bytes = await doc.save({ updateFieldAppearances: false });
  writeFileSync(`test/fixtures/_out/${name}.roundtrip.pdf`, bytes);
  console.log(`${name}: ${readFileSync(src).length} -> ${bytes.length} bytes`);
}
