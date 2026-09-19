/**
 * OCR spike: can we write an INVISIBLE text layer that extracts back correctly?
 *
 * The whole "make searchable" feature depends on it. Two open questions:
 *   1. Does pdf-lib's font subsetting still generate a usable ToUnicode CMap?
 *      (That CMap is what makes Ctrl+F and copy/paste return real characters.)
 *   2. Does Helvetica-for-Latin / Noto-for-Hebrew round-trip both scripts?
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState,
  beginText, endText, setFontAndSize, setTextMatrix, showText,
  setTextRenderingMode, TextRenderingMode,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

mkdirSync('test/fixtures/_out', { recursive: true });

const LATIN = ['Hello', 'searchable', 'invoice', 'Total:', '1,234.56'];
const HEBREW = ['שלום', 'חשבונית', 'סך', 'הכל', 'עברית'];

async function build({ subset }) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const noto = await doc.embedFont(
    readFileSync('vendor/fonts/NotoSansHebrew-Regular.ttf'), { subset },
  );

  const page = doc.addPage([612, 792]);
  const helvKey = page.node.newFontDictionary('F-latin', helv.ref);
  const notoKey = page.node.newFontDictionary('F-heb', noto.ref);

  let y = 700;
  const place = (word, font, key) => {
    page.pushOperators(
      pushGraphicsState(),
      beginText(),
      // Mode 3 = fill none, stroke none: laid down but never painted.
      setTextRenderingMode(TextRenderingMode.Invisible),
      setFontAndSize(key, 12),
      setTextMatrix(1, 0, 0, 1, 72, y),
      showText(font.encodeText(word)),
      endText(),
      popGraphicsState(),
    );
    y -= 18;
  };

  for (const w of LATIN) place(w, helv, helvKey);
  for (const w of HEBREW) place(w, noto, notoKey);

  const out = `test/fixtures/_out/ocr-text-subset-${subset}.pdf`;
  writeFileSync(out, await doc.save());
  return out;
}

async function extract(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(file)),
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  await doc.loadingTask?.destroy?.();
  return content.items.map((i) => i.str).filter((s) => s.trim());
}

for (const subset of [true, false]) {
  const file = await build({ subset });
  const got = await extract(file);
  const want = [...LATIN, ...HEBREW];

  const size = readFileSync(file).length;
  const missing = want.filter((w) => !got.includes(w));

  console.log(`\n=== subset: ${subset} === (${(size / 1024).toFixed(1)} KB)`);
  console.log('  extracted:', JSON.stringify(got));
  console.log(missing.length ? `  MISSING: ${JSON.stringify(missing)}` : '  ALL WORDS ROUND-TRIPPED');
}
