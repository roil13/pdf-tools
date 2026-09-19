// Generates the PDFs the Step 0 spike needs.
// Writing the outline tree here is deliberate: it is the same low-level
// /Outlines construction that Step 6's merge post-pass needs.
import { writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument, PDFName, PDFNumber, PDFHexString, StandardFonts, rgb } from 'pdf-lib';

const OUT = new URL('../test/fixtures/', import.meta.url);
mkdirSync(OUT, { recursive: true });

/** Build pages numbered 1..n with big visible labels. */
async function makePages(doc, n, label) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${label} — page ${i}`, { x: 60, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  }
}

/**
 * Attach a top-level outline tree. `items` = [{ title, pageIndex, children? }].
 * Creates the /Outlines root from scratch (the "no existing outline" path).
 */
function addOutline(doc, items) {
  const ctx = doc.context;
  const rootRef = ctx.nextRef();

  const buildLevel = (entries, parentRef) => {
    const refs = entries.map(() => ctx.nextRef());
    let visible = entries.length;
    entries.forEach((entry, i) => {
      const kids = entry.children?.length ? buildLevel(entry.children, refs[i]) : null;
      if (kids) visible += kids.count; // children are open => they count as visible
      const dict = {
        Title: PDFHexString.fromText(entry.title),
        Parent: parentRef,
        Dest: [doc.getPage(entry.pageIndex).ref, PDFName.of('Fit')],
      };
      if (i > 0) dict.Prev = refs[i - 1];
      if (i < entries.length - 1) dict.Next = refs[i + 1];
      if (kids) {
        dict.First = kids.first;
        dict.Last = kids.last;
        dict.Count = kids.count; // positive => open
      }
      ctx.assign(refs[i], ctx.obj(dict));
    });
    return { first: refs[0], last: refs[refs.length - 1], count: visible };
  };

  const level = buildLevel(items, rootRef);
  ctx.assign(rootRef, ctx.obj({
    Type: 'Outlines',
    First: level.first,
    Last: level.last,
    Count: PDFNumber.of(level.count),
  }));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
}

// ---- fixture 1: outlines + AcroForm, 10 pages -------------------------------
{
  const doc = await PDFDocument.create();
  doc.setTitle('Outlined Form Fixture');
  await makePages(doc, 10, 'Outlined');

  addOutline(doc, [
    { title: 'Chapter One', pageIndex: 0, children: [
      { title: 'Section 1.1', pageIndex: 1 },
      { title: 'Section 1.2 (page 5, will be dropped)', pageIndex: 4 },
    ]},
    { title: 'Chapter Two', pageIndex: 5 },
    { title: 'פרק שלוש', pageIndex: 7 },   // Hebrew title -> exercises UTF-16 text strings
  ]);

  const form = doc.getForm();
  const field = form.createTextField('spike.name');
  field.setText('hello');
  field.addToPage(doc.getPage(0), { x: 60, y: 600, width: 300, height: 30 });

  writeFileSync(new URL('outlined-form.pdf', OUT), await doc.save());
}

// ---- fixture 2: plain, no outlines, no form ---------------------------------
{
  const doc = await PDFDocument.create();
  doc.setTitle('Plain Fixture');
  await makePages(doc, 10, 'Plain');
  writeFileSync(new URL('plain.pdf', OUT), await doc.save());
}

// ---- fixture 3: short doc used as merge input B/C ----------------------------
for (const [name, label, n] of [['beta.pdf', 'Beta', 3], ['gamma.pdf', 'Gamma', 2]]) {
  const doc = await PDFDocument.create();
  await makePages(doc, n, label);
  writeFileSync(new URL(name, OUT), await doc.save());
}

// ---- fixture 4: genuinely blank pages ---------------------------------------
// Models a scan: no text of its own, so an added OCR text layer is the only
// text a extractor can find.
{
  const doc = await PDFDocument.create();
  doc.setTitle('Blank Fixture');
  for (let i = 0; i < 3; i++) doc.addPage([612, 792]);
  writeFileSync(new URL('blank.pdf', OUT), await doc.save());
}

console.log('fixtures written to test/fixtures/');
