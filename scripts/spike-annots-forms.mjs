// Phase 2 gate (2d + 2e): can the reader write annotations and fill form fields
// with pdf-lib without destroying the document structure the app exists to protect?
//
// The README's thesis is that pure-JS libraries drop /Outlines and /AcroForm. That
// is about COPYING PAGES BETWEEN DOCUMENTS, which rebuilds the document root. An
// in-place load -> modify -> save does not, and electron/outline.ts already relies
// on it. This checks that the distinction actually holds for the two things the
// reader wants to do -- and what it costs to make a Hebrew field value render.
//
// Run: node scripts/spike-annots-forms.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString,
  StandardFonts, rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const NATIVE = 'vendor/qpdf/qpdf.exe';
const OUT = 'test/fixtures/_out/reader';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

/** Structure per the NATIVE binary -- an independent reader, as the tests do. */
function structure(file) {
  const j = JSON.parse(execFileSync(NATIVE, [
    '--json', '--json-key=pages', '--json-key=acroform',
    '--json-key=outlines', '--json-key=encrypt', file,
  ], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }));
  const flat = (items) => (items ?? []).flatMap((i) => [i, ...flat(i.kids)]);
  const o = flat(j.outlines);
  return {
    pages: j.pages.length,
    form: j.acroform?.hasacroform ?? false,
    fields: (j.acroform?.fields ?? []).length,
    outlines: o.length,
    titles: o.map((x) => x.title).join('|'),
  };
}

const SRC = 'test/fixtures/outlined-form.pdf';
const before = structure(SRC);
console.log(`\nsource: ${JSON.stringify(before)}\n`);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ===========================================================================
console.log('=== 1. Adding a real /Highlight annotation ===');
{
  const doc = await PDFDocument.load(readFileSync(SRC));
  const page = doc.getPages()[0];
  const ctx = doc.context;

  // A text-markup annotation is defined by QuadPoints: four corners per quad, in
  // the order x1 y1 x2 y2 x3 y3 x4 y4 = upper-left, upper-right, lower-left,
  // lower-right. Getting that order wrong renders a bowtie, and no viewer warns.
  const quad = [72, 700, 300, 700, 72, 684, 300, 684];
  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [72, 684, 300, 700],
    QuadPoints: quad,
    C: [1, 0.92, 0.23],
    CA: 0.4,
    F: 4,                                    // Print
    T: PDFHexString.fromText('Reader'),      // UTF-16BE, so Hebrew authors survive
    Contents: PDFHexString.fromText('שלום note'),
  });
  const ref = ctx.register(annot);

  let annots = page.node.get(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) {
    annots = ctx.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(ref);

  const out = `${OUT}/annotated.pdf`;
  writeFileSync(out, await doc.save({ updateFieldAppearances: false }));
  const after = structure(out);
  check('structure survives an added annotation', same(before, after),
    same(before, after) ? '' : `\n         before=${JSON.stringify(before)}\n         after =${JSON.stringify(after)}`);

  // And the annotation is actually there, per an independent read.
  const back = await PDFDocument.load(readFileSync(out));
  const list = back.getPages()[0].node.get(PDFName.of('Annots'));
  const found = list instanceof PDFArray && list.asArray().some((r) => {
    const d = back.context.lookupMaybe(r, PDFDict);
    return d?.get(PDFName.of('Subtype')) === PDFName.of('Highlight');
  });
  check('the /Highlight is readable back', found);
}

// ===========================================================================
console.log('\n=== 2. Filling a form field (Latin) ===');
{
  const doc = await PDFDocument.load(readFileSync(SRC));
  const form = doc.getForm();
  const names = form.getFields().map((f) => f.getName());
  check('the fixture has the expected field', names.includes('spike.name'), names.join(','));

  form.getTextField('spike.name').setText('filled by the reader');

  // updateFieldAppearances: true is the DEFAULT on save(). It regenerates the
  // appearance stream, which is what makes the value visible in a viewer that
  // does not render field values itself.
  const out = `${OUT}/filled-latin.pdf`;
  writeFileSync(out, await doc.save());
  const after = structure(out);
  check('structure survives filling', same(before, after),
    same(before, after) ? '' : `\n         before=${JSON.stringify(before)}\n         after =${JSON.stringify(after)}`);

  const back = await PDFDocument.load(readFileSync(out));
  check('value round-trips',
    back.getForm().getTextField('spike.name').getText() === 'filled by the reader');
  // Read /AP straight off the widget dict rather than through a helper, so this
  // asserts what is in the file rather than what pdf-lib is willing to synthesise.
  const widget = back.getForm().getTextField('spike.name').acroField.getWidgets()[0];
  const ap = widget.dict.get(PDFName.of('AP'));
  check('an appearance stream was generated', !!ap);
}

// ===========================================================================
console.log('\n=== 3. Filling with HEBREW -- the real question ===');
{
  // The default appearance font is Helvetica, which is WinAnsi-encoded and has no
  // Hebrew glyphs. pdf-lib throws rather than silently writing mojibake, so a
  // Unicode font must be embedded and the appearance regenerated against it.
  const doc = await PDFDocument.load(readFileSync(SRC));
  doc.registerFontkit(fontkit);
  const form = doc.getForm();
  const field = form.getTextField('spike.name');

  let threwWithoutFont = false;
  try {
    field.setText('שלום עולם');
    // Force appearance generation with the default (Helvetica) font.
    form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  } catch (e) {
    threwWithoutFont = true;
    console.log(`        (as expected: ${String(e.message).split('\n')[0].slice(0, 90)})`);
  }
  check('Helvetica cannot encode Hebrew, and pdf-lib says so rather than mangling it',
    threwWithoutFont);
}
{
  const doc = await PDFDocument.load(readFileSync(SRC));
  doc.registerFontkit(fontkit);
  // Same font the OCR text layer already embeds for exactly this reason.
  const hebrew = await doc.embedFont(readFileSync('vendor/fonts/NotoSansHebrew-Regular.ttf'), {
    // NOT subset: a form field can be edited later by another viewer, which would
    // then need glyphs this subset never included.
    subset: false,
  });
  const form = doc.getForm();
  const field = form.getTextField('spike.name');
  field.setText('שלום עולם');
  field.updateAppearances(hebrew);

  const out = `${OUT}/filled-hebrew.pdf`;
  // Already regenerated above with the right font; letting save() do it again
  // with the default font would throw.
  writeFileSync(out, await doc.save({ updateFieldAppearances: false }));
  const after = structure(out);
  check('structure survives a Hebrew fill', same(before, after),
    same(before, after) ? '' : `\n         before=${JSON.stringify(before)}\n         after =${JSON.stringify(after)}`);

  const back = await PDFDocument.load(readFileSync(out));
  check('Hebrew value round-trips',
    back.getForm().getTextField('spike.name').getText() === 'שלום עולם',
    JSON.stringify(back.getForm().getTextField('spike.name').getText()));
  const sizes = [readFileSync(SRC).length, readFileSync(out).length];
  console.log(`        size ${sizes[0]} -> ${sizes[1]} bytes (embedded Hebrew font, unsubsetted)`);
}

// ===========================================================================
console.log('\n=== 4. Annotation + fill together, then through qpdf ===');
{
  // The realistic pipeline: the reader saves, and the user later runs another
  // tool on the result. qpdf must still be able to process what pdf-lib wrote.
  const doc = await PDFDocument.load(readFileSync(`${OUT}/annotated.pdf`));
  doc.registerFontkit(fontkit);
  const hebrew = await doc.embedFont(readFileSync('vendor/fonts/NotoSansHebrew-Regular.ttf'), { subset: false });
  const field = doc.getForm().getTextField('spike.name');
  field.setText('שלום');
  field.updateAppearances(hebrew);
  const both = `${OUT}/annotated-and-filled.pdf`;
  writeFileSync(both, await doc.save({ updateFieldAppearances: false }));
  check('structure survives both', same(before, structure(both)));

  // Now the app's own compress pass over it.
  const compressed = `${OUT}/annotated-compressed.pdf`;
  execFileSync(NATIVE, [
    '--recompress-flate', '--compression-level=9',
    '--object-streams=generate', '--compress-streams=y', both, compressed,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  check('qpdf can still process the result', same(before, structure(compressed)));

  const back = await PDFDocument.load(readFileSync(compressed));
  check('the annotation survives a qpdf round-trip', (() => {
    const list = back.getPages()[0].node.get(PDFName.of('Annots'));
    return list instanceof PDFArray && list.asArray().some((r) => {
      const d = back.context.lookupMaybe(r, PDFDict);
      return d?.get(PDFName.of('Subtype')) === PDFName.of('Highlight');
    });
  })());
  check('the field value survives a qpdf round-trip',
    back.getForm().getTextField('spike.name').getText() === 'שלום');
}

// Silence unused-import noise from the experiment scaffolding.
void PDFNumber; void PDFString; void rgb;

console.log(`\n${failures === 0 ? 'SPIKE PASSED' : `SPIKE FAILED (${failures})`}\n`);
process.exit(failures === 0 ? 0 : 1);
