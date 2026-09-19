// Builds an image-only PDF: a synthetic scan with no text layer of its own.
// This is the real input shape for "Make Searchable".
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const png = readFileSync('test/fixtures/ocr-sample.png');
const doc = await PDFDocument.create();
const img = await doc.embedPng(png);

// Place the bitmap at 150 dpi onto a Letter page, like a real scan.
const page = doc.addPage([612, 792]);
const w = img.width / 2;
const h = img.height / 2;
page.drawImage(img, { x: 40, y: 792 - h - 60, width: w, height: h });

writeFileSync('test/fixtures/scan.pdf', await doc.save());
console.log(`scan.pdf written (${img.width}x${img.height} image, no text layer)`);
