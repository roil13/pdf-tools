import { PDFDocument, degrees } from 'pdf-lib';
import { toJpegBytes, type DecodedImage } from './imageDecode.js';
import { isFullCrop, toPixels, type CropRect } from './cropRect.js';

export type PageSize = 'fit' | 'a4' | 'letter';

/** PDF's maximum page side, in points: 200 inches. */
const MAX_PAGE_UNITS = 14400;

/** Page sizes in PDF points (72 per inch), portrait. */
const SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Where an image sits on its page, in PDF points. */
export interface Placement {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Work out the page and the image's box on it.
 *
 * Pure and exported so the geometry can be tested without a canvas -- building
 * the actual PDF needs a browser to encode the bitmap.
 */
export function placeImage(
  img: { width: number; height: number },
  pageSize: PageSize,
  margin: number,
): Placement {
  const w = Math.max(1, img.width);
  const h = Math.max(1, img.height);

  if (pageSize === 'fit') {
    // A page side may not exceed 14400 units (200 inches) in PDF, and a large
    // panorama at one pixel per point sails past that -- some viewers then
    // refuse the file. Scale proportionally; the image still fills the page
    // exactly, just at a higher effective resolution.
    const over = Math.max(w, h) / MAX_PAGE_UNITS;
    const scale = over > 1 ? 1 / over : 1;
    const pw = w * scale;
    const ph = h * scale;
    return { pageWidth: pw, pageHeight: ph, x: 0, y: 0, width: pw, height: ph };
  }

  const [shortEdge, longEdge] = SIZES[pageSize];
  const landscape = w > h;
  const pageWidth = landscape ? longEdge : shortEdge;
  const pageHeight = landscape ? shortEdge : longEdge;

  const availW = Math.max(1, pageWidth - margin * 2);
  const availH = Math.max(1, pageHeight - margin * 2);
  const scale = Math.min(availW / w, availH / h);
  const width = w * scale;
  const height = h * scale;

  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}

/** A decoded image, optionally turned by the user before it becomes a page. */
export interface PlacedImage extends DecodedImage {
  /** Quarter turns clockwise, 0-3. Absent means none. */
  turns?: number;
  /** Region to keep, as fractions of the image. Absent means all of it. */
  crop?: CropRect;
}

export interface BuildOptions {
  pageSize: PageSize;
  /** Margin in points, ignored when pageSize is 'fit'. */
  margin: number;
  quality: number;
}

/**
 * Build a PDF from decoded images, one page each.
 *
 * 'fit' makes each page exactly the image's pixel size at 72 dpi, so nothing is
 * scaled or letterboxed. The fixed sizes centre the image inside the margins,
 * choosing portrait or landscape per image so a landscape photo does not end up
 * shrunk into a portrait page.
 */
export async function buildPdfFromImages(
  images: PlacedImage[],
  opts: BuildOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  for (const img of images) {
    // This path re-encodes every image anyway, so a crop costs nothing extra
    // here beyond the smaller canvas -- unlike the scanner path, where it is the
    // only thing that touches pixels.
    const box = img.crop && !isFullCrop(img.crop)
      ? toPixels(img.crop, img.width, img.height)
      : undefined;
    const jpeg = await toJpegBytes(img.bitmap, opts.quality, box);
    const embedded = await doc.embedJpg(jpeg);

    // The page is sized to what is KEPT, not to the original.
    const p = placeImage(box ?? img, opts.pageSize, opts.margin);
    const page = doc.addPage([p.pageWidth, p.pageHeight]);
    page.drawImage(embedded, { x: p.x, y: p.y, width: p.width, height: p.height });
    // Rotating the page rather than the pixels: a quarter turn then costs
    // nothing and loses nothing, where redrawing a rotated bitmap would put the
    // image through another encode for no gain. Same reasoning as the scanner.
    const turns = (img.turns ?? 0) % 4;
    if (turns !== 0) page.setRotation(degrees(turns * 90));
  }

  return doc.save();
}

/** One page from the OS document scanner: an already perspective-corrected JPEG. */
export interface ScannedPage {
  /** The scanner's own JPEG, embedded untouched. */
  jpeg: Uint8Array;
  width: number;
  height: number;
  /** Quarter turns clockwise the user asked for, 0-3. */
  turns: number;
}

/**
 * Build a PDF from scanned pages.
 *
 * Separate from `buildPdfFromImages` for two reasons, both about what a scanner
 * hands us that a file picker does not:
 *
 * - The bytes are ALREADY a perspective-corrected JPEG from the OS, so they are
 *   embedded as-is. Decoding them to a bitmap and re-encoding, as the images
 *   path must, would compress an already-lossy image a second time for nothing.
 * - It never holds a decoded bitmap. A 24-page scan at full resolution is well
 *   over a gigabyte of `ImageBitmap`, which is not a thing a phone will do.
 *
 * Rotation is applied to the PAGE rather than to the pixels, the same way
 * Edit Pages rotates through qpdf: a quarter turn then costs nothing and loses
 * nothing, where re-encoding a rotated bitmap would cost both.
 */
export async function buildPdfFromScans(
  pages: ScannedPage[],
  opts: BuildOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  for (const scan of pages) {
    const embedded = await doc.embedJpg(scan.jpeg);
    const p = placeImage(scan, opts.pageSize, opts.margin);
    const page = doc.addPage([p.pageWidth, p.pageHeight]);
    page.drawImage(embedded, { x: p.x, y: p.y, width: p.width, height: p.height });
    // A viewer applies /Rotate to the whole page, so the image needs no transform.
    if (scan.turns % 4 !== 0) page.setRotation(degrees((scan.turns % 4) * 90));
  }

  return doc.save();
}
