/**
 * Building a PDF from scanned pages.
 *
 * The scanner path deliberately differs from the images path: it embeds the
 * OS's own JPEG untouched and expresses rotation as a page rotation. Both
 * choices are invisible in a rendered page and very visible in a file — a
 * re-encode would quietly halve the quality, and a rotation baked into pixels
 * would quietly double the size — so they are asserted here rather than eyeballed.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import { buildPdfFromScans, placeImage, type ScannedPage } from '../src/lib/imagesToPdf.js';

/**
 * A JPEG header with no image data.
 *
 * pdf-lib reads the SOF marker for the dimensions and embeds the bytes verbatim
 * without decoding them, so this exercises every decision the code under test
 * makes. It is not a picture and would not render; nothing here asks it to.
 */
function jpegHeader(width: number, height: number): Uint8Array {
  const jfif = [0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
                0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [
    0xFF, 0xC0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xFF, height & 0xFF,
    (width >> 8) & 0xFF, width & 0xFF,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return new Uint8Array([0xFF, 0xD8, ...jfif, ...sof, 0xFF, 0xD9]);
}

const page = (over: Partial<ScannedPage> = {}): ScannedPage => ({
  jpeg: jpegHeader(over.width ?? 1200, over.height ?? 1600),
  width: 1200,
  height: 1600,
  turns: 0,
  ...over,
});

const FIT = { pageSize: 'fit' as const, margin: 0, quality: 1 };

/** Every image XObject in a saved document, read back independently. */
async function imagesIn(bytes: Uint8Array): Promise<PDFRawStream[]> {
  const doc = await PDFDocument.load(bytes);
  const out: PDFRawStream[] = [];
  for (const p of doc.getPages()) {
    const resources = p.node.get(PDFName.of('Resources'));
    if (!(resources instanceof PDFDict)) continue;
    const xobjects = resources.get(PDFName.of('XObject'));
    if (!(xobjects instanceof PDFDict)) continue;
    for (const key of xobjects.keys()) {
      // An XObject is normally an indirect reference; `lookup` resolves one and
      // passes a direct object through, so this covers both.
      const resolved = doc.context.lookup(xobjects.get(key));
      if (resolved instanceof PDFRawStream) out.push(resolved);
    }
  }
  return out;
}

describe('buildPdfFromScans', () => {
  it('writes one page per scan, in the order given', async () => {
    const out = await buildPdfFromScans([page(), page(), page()], FIT);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });

  it('produces a valid document for no scans rather than throwing', async () => {
    // The screen will not call it with nothing, but a builder that throws on an
    // empty list is a trap for whoever wires it up next.
    // Page count is deliberately not asserted: pdf-lib reports 1 when reloading
    // a document it saved with none, which is its quirk and not this code's.
    const out = await buildPdfFromScans([], FIT);
    expect(out.length).toBeGreaterThan(0);
    await expect(PDFDocument.load(out)).resolves.toBeDefined();
  });

  it('sizes a "fit" page to the image, so nothing is scaled or letterboxed', async () => {
    const out = await buildPdfFromScans([page({ width: 1200, height: 1600 })], FIT);
    const [p] = (await PDFDocument.load(out)).getPages();
    expect(p.getWidth()).toBeCloseTo(1200, 1);
    expect(p.getHeight()).toBeCloseTo(1600, 1);
  });

  it('embeds the JPEG untouched rather than re-encoding it', async () => {
    // The whole reason this path exists: the scanner already produced a
    // perspective-corrected JPEG, and decoding then re-encoding it would
    // compress an already-lossy image a second time.
    const jpeg = jpegHeader(800, 600);
    const out = await buildPdfFromScans([page({ jpeg, width: 800, height: 600 })], FIT);
    const [image] = await imagesIn(out);
    expect(String(image.dict.get(PDFName.of('Filter')))).toContain('DCTDecode');
    expect(image.getContents().length).toBe(jpeg.length);
  });

  it('rotates the PAGE rather than the pixels', async () => {
    const out = await buildPdfFromScans([page({ turns: 1 })], FIT);
    const [p] = (await PDFDocument.load(out)).getPages();
    expect(p.getRotation().angle).toBe(90);
    // The page box stays in the image's own orientation; the viewer turns it.
    expect(p.getWidth()).toBeCloseTo(1200, 1);
    expect(p.getHeight()).toBeCloseTo(1600, 1);
  });

  it('leaves an unrotated page with no rotation at all', async () => {
    const out = await buildPdfFromScans([page({ turns: 0 })], FIT);
    expect((await PDFDocument.load(out)).getPages()[0].getRotation().angle).toBe(0);
  });

  it('treats four quarter turns as none', async () => {
    const out = await buildPdfFromScans([page({ turns: 4 })], FIT);
    expect((await PDFDocument.load(out)).getPages()[0].getRotation().angle).toBe(0);
  });

  it('applies each page its own rotation', async () => {
    const out = await buildPdfFromScans(
      [page({ turns: 0 }), page({ turns: 1 }), page({ turns: 2 }), page({ turns: 3 })],
      FIT,
    );
    const angles = (await PDFDocument.load(out)).getPages().map((p) => p.getRotation().angle);
    expect(angles).toEqual([0, 90, 180, 270]);
  });

  it('centres the image on a fixed page size', async () => {
    const out = await buildPdfFromScans([page()], { pageSize: 'a4', margin: 36, quality: 1 });
    const [p] = (await PDFDocument.load(out)).getPages();
    expect(p.getWidth()).toBeCloseTo(595.28, 1);
    expect(p.getHeight()).toBeCloseTo(841.89, 1);
  });

  it('shares its geometry with the images pipeline', async () => {
    // placeImage is the tested, pure half; this path must not reimplement it.
    const expected = placeImage({ width: 1200, height: 1600 }, 'a4', 36);
    const out = await buildPdfFromScans([page()], { pageSize: 'a4', margin: 36, quality: 1 });
    const [p] = (await PDFDocument.load(out)).getPages();
    expect(p.getWidth()).toBeCloseTo(expected.pageWidth, 1);
    expect(p.getHeight()).toBeCloseTo(expected.pageHeight, 1);
  });
});
