/**
 * Annotation geometry and the write/read round-trip.
 *
 * The quad-point ordering is the part that fails silently: get it wrong and
 * viewers render a bowtie instead of a highlight, with no error anywhere. The
 * round-trip tests write real PDF objects and read them back, so a change that
 * produces a structurally valid but meaningless annotation is caught here rather
 * than by eye.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef } from 'pdf-lib';
import {
  quadPoints, boundsOf, toRgb, writeAnnotations, readAnnotations,
  writeFormValues, formNeedsUnicodeFont,
  type Annotation, type Quad,
} from '../src/reader/annotations.js';

const SRC = 'test/fixtures/outlined-form.pdf';
const HEBREW_FONT = 'vendor/fonts/NotoSansHebrew-Regular.ttf';

const quad = (x: number, y: number, w: number, h: number): Quad =>
  ({ x, y, width: w, height: h });

const markup = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1', kind: 'highlight', page: 1, color: '#ffd54a',
  quads: [quad(72, 684, 228, 16)], source: 'new', ...over,
});

describe('quadPoints', () => {
  it('orders corners upper-left, upper-right, lower-left, lower-right', () => {
    // NOT clockwise. A clockwise winding renders as a bowtie.
    expect(quadPoints(quad(10, 20, 100, 8))).toEqual([
      10, 28, 110, 28,   // upper-left, upper-right
      10, 20, 110, 20,   // lower-left, lower-right
    ]);
  });

  it('puts the top edge first, because PDF y grows upward', () => {
    const [, y1, , y2, , y3, , y4] = quadPoints(quad(0, 100, 10, 12));
    expect(y1).toBe(112);
    expect(y2).toBe(112);
    expect(y3).toBe(100);
    expect(y4).toBe(100);
  });

  it('emits exactly eight numbers', () => {
    expect(quadPoints(quad(1, 2, 3, 4))).toHaveLength(8);
  });
});

describe('boundsOf', () => {
  it('spans every quad', () => {
    expect(boundsOf([quad(10, 10, 10, 10), quad(50, 40, 20, 5)]))
      .toEqual([10, 10, 70, 45]);
  });

  it('handles a single quad', () => {
    expect(boundsOf([quad(5, 6, 7, 8)])).toEqual([5, 6, 12, 14]);
  });
});

describe('toRgb', () => {
  it('converts hex to the 0..1 components a PDF colour array wants', () => {
    expect(toRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(toRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('accepts a missing hash', () => {
    expect(toRgb('ff0000')).toEqual([1, 0, 0]);
  });

  it('falls back rather than producing NaN for junk', () => {
    expect(toRgb('not a colour').every(Number.isFinite)).toBe(true);
  });
});

/* ------------------------------------------------------------- round-trip */

/** Every annotation dict on a page, per an independent load. */
async function annotsOnPage(bytes: Uint8Array, pageIndex: number): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes);
  const list = doc.getPages()[pageIndex].node.get(PDFName.of('Annots'));
  if (!(list instanceof PDFArray)) return [];
  return list.asArray()
    .map((e) => (e instanceof PDFRef ? doc.context.lookupMaybe(e, PDFDict) : (e as PDFDict)))
    .filter((d): d is PDFDict => !!d);
}

const subtypeOf = (d: PDFDict) => String(d.get(PDFName.of('Subtype'))).replace('/', '');

describe('writeAnnotations', () => {
  const original = () => new Uint8Array(readFileSync(SRC));

  it('adds a /Highlight with quad points to the right page', async () => {
    const out = await writeAnnotations(original(), [markup()], 'Tester');
    const annots = await annotsOnPage(out, 0);
    const highlight = annots.find((d) => subtypeOf(d) === 'Highlight');
    expect(highlight).toBeDefined();
    const qp = highlight!.get(PDFName.of('QuadPoints'));
    expect(qp instanceof PDFArray && qp.asArray()).toHaveLength(8);
  });

  it('writes each markup kind with its own subtype', async () => {
    const out = await writeAnnotations(original(), [
      markup({ id: 'h', kind: 'highlight' }),
      markup({ id: 'u', kind: 'underline' }),
      markup({ id: 's', kind: 'strikeout' }),
    ], 'Tester');
    const subtypes = (await annotsOnPage(out, 0)).map(subtypeOf);
    expect(subtypes).toContain('Highlight');
    expect(subtypes).toContain('Underline');
    expect(subtypes).toContain('StrikeOut');
  });

  it('writes a note as a /Text annotation', async () => {
    const out = await writeAnnotations(original(), [{
      id: 'n', kind: 'note', page: 1, color: '#68c9f2',
      point: { x: 100, y: 700 }, contents: 'look here', source: 'new',
    }], 'Tester');
    expect((await annotsOnPage(out, 0)).map(subtypeOf)).toContain('Text');
  });

  it('writes ink as an /Ink annotation with one array per stroke', async () => {
    const out = await writeAnnotations(original(), [{
      id: 'i', kind: 'ink', page: 1, color: '#7ee081', source: 'new',
      strokes: [[{ x: 10, y: 10 }, { x: 20, y: 30 }], [{ x: 40, y: 40 }, { x: 50, y: 50 }]],
    }], 'Tester');
    const ink = (await annotsOnPage(out, 0)).find((d) => subtypeOf(d) === 'Ink');
    expect(ink).toBeDefined();
    const list = ink!.get(PDFName.of('InkList'));
    expect(list instanceof PDFArray && list.asArray()).toHaveLength(2);
  });

  it('puts an annotation on the page it names, not always the first', async () => {
    const out = await writeAnnotations(original(), [markup({ page: 4 })], 'Tester');
    expect(await annotsOnPage(out, 0)).toHaveLength(1);   // the pre-existing form widget
    expect((await annotsOnPage(out, 3)).map(subtypeOf)).toContain('Highlight');
  });

  it('never writes an annotation that came from the file', async () => {
    // Otherwise every save would add a second copy of every existing mark.
    const out = await writeAnnotations(original(), [markup({ source: 'file' })], 'Tester');
    expect((await annotsOnPage(out, 0)).map(subtypeOf)).not.toContain('Highlight');
  });

  it('leaves the outline and the form intact', async () => {
    const out = await writeAnnotations(original(), [markup()], 'Tester');
    const doc = await PDFDocument.load(out);
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeDefined();
    expect(doc.getForm().getFields().map((f) => f.getName())).toContain('spike.name');
    expect(doc.getPageCount()).toBe(10);
  });

  it('ignores an annotation pointing past the end of the document', async () => {
    const out = await writeAnnotations(original(), [markup({ page: 999 })], 'Tester');
    expect(await PDFDocument.load(out).then((d) => d.getPageCount())).toBe(10);
  });
});

describe('readAnnotations', () => {
  it('reads back what was written, marked as coming from the file', async () => {
    const out = await writeAnnotations(new Uint8Array(readFileSync(SRC)), [
      markup({ id: 'h', kind: 'highlight', page: 2 }),
      markup({ id: 'u', kind: 'underline', page: 3 }),
    ], 'Tester');

    const back = await readAnnotations(out);
    expect(back.map((a) => a.kind).sort()).toEqual(['highlight', 'underline']);
    expect(back.map((a) => a.page).sort()).toEqual([2, 3]);
    expect(back.every((a) => a.source === 'file')).toBe(true);
  });

  it('recovers the marked rectangle, not a degenerate one', async () => {
    const out = await writeAnnotations(new Uint8Array(readFileSync(SRC)),
      [markup({ quads: [quad(72, 684, 228, 16)] })], 'Tester');
    const [back] = await readAnnotations(out);
    const q = back.quads![0];
    expect(q.x).toBeCloseTo(72, 3);
    expect(q.y).toBeCloseTo(684, 3);
    expect(q.width).toBeCloseTo(228, 3);
    expect(q.height).toBeCloseTo(16, 3);
  });

  it('round-trips without growing on every save', async () => {
    // Write, read, write again: the second write must add nothing, because
    // everything it was given came from the file.
    const first = await writeAnnotations(new Uint8Array(readFileSync(SRC)), [markup()], 'Tester');
    const readBack = await readAnnotations(first);
    const second = await writeAnnotations(first, readBack, 'Tester');
    expect((await annotsOnPage(second, 0)).filter((d) => subtypeOf(d) === 'Highlight'))
      .toHaveLength(1);
  });

  it('finds nothing in a document that has none', async () => {
    expect(await readAnnotations(new Uint8Array(readFileSync('test/fixtures/plain.pdf'))))
      .toEqual([]);
  });
});

/* ------------------------------------------------------------------ forms */

describe('writeFormValues', () => {
  const original = () => new Uint8Array(readFileSync(SRC));

  it('sets a text field and keeps the document intact', async () => {
    const out = await writeFormValues(original(), [{ name: 'spike.name', value: 'hello there' }], null);
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getTextField('spike.name').getText()).toBe('hello there');
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeDefined();
    expect(doc.getPageCount()).toBe(10);
  });

  it('skips a field that is not there rather than failing the whole save', async () => {
    const out = await writeFormValues(original(), [
      { name: 'does.not.exist', value: 'x' },
      { name: 'spike.name', value: 'still written' },
    ], null);
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getTextField('spike.name').getText()).toBe('still written');
  });

  it('writes a Hebrew value when given a Unicode font', async () => {
    const font = new Uint8Array(readFileSync(HEBREW_FONT));
    const out = await writeFormValues(original(), [{ name: 'spike.name', value: 'שלום עולם' }], font);
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getTextField('spike.name').getText()).toBe('שלום עולם');
  });

  it('generates an appearance stream for the Hebrew value', async () => {
    // Without one, a viewer that does not render field values itself shows an
    // empty box -- the value would be in the file but invisible.
    const font = new Uint8Array(readFileSync(HEBREW_FONT));
    const out = await writeFormValues(original(), [{ name: 'spike.name', value: 'שלום' }], font);
    const doc = await PDFDocument.load(out);
    const widget = doc.getForm().getTextField('spike.name').acroField.getWidgets()[0];
    expect(widget.dict.get(PDFName.of('AP'))).toBeDefined();
  });

  it('throws rather than writing mojibake when Hebrew has no font', async () => {
    // pdf-lib refuses to encode Hebrew in WinAnsi. Surfacing that is correct:
    // silently writing the wrong bytes would be worse.
    await expect(writeFormValues(original(), [{ name: 'spike.name', value: 'שלום' }], null))
      .rejects.toThrow();
  });
});

describe('formNeedsUnicodeFont', () => {
  it('is false for plain Latin, so the font is not embedded needlessly', () => {
    expect(formNeedsUnicodeFont([{ name: 'a', value: 'plain ascii 123' }])).toBe(false);
  });

  it('is true as soon as one value needs it', () => {
    expect(formNeedsUnicodeFont([
      { name: 'a', value: 'plain' },
      { name: 'b', value: 'שלום' },
    ])).toBe(true);
  });
});
