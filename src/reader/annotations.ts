/**
 * Reader annotations: the in-memory model, and how it becomes real PDF objects.
 *
 * Annotations are written by loading the document with pdf-lib and saving it
 * again IN PLACE. The README warns that pure-JS libraries drop `/Outlines` and
 * `/AcroForm`, and that warning is about copying pages BETWEEN documents, which
 * rebuilds the document root. Loading and saving one document does not --
 * `electron/outline.ts` has always relied on that, and
 * `scripts/spike-annots-forms.mjs` checks it for this path specifically,
 * including a qpdf round-trip afterwards.
 */
import {
  PDFDocument, PDFName, PDFArray, PDFHexString, PDFDict, PDFRef, rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { needsUnicodeFont } from '../lib/textLayer.js';

export type AnnotKind = 'highlight' | 'underline' | 'strikeout' | 'note' | 'ink';

/** A point in PDF user space (origin bottom-left, y up). */
export interface Point {
  x: number;
  y: number;
}

/**
 * One rectangle of marked text, in PDF user space.
 *
 * Stored as a rectangle rather than four free corners because that is what text
 * selection produces, and it keeps the quad-point ordering in exactly one place
 * (`quadPoints` below) where it can be got right once.
 */
export interface Quad {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Annotation {
  id: string;
  kind: AnnotKind;
  /** 1-indexed. */
  page: number;
  /** `#rrggbb`. */
  color: string;
  /** Text-markup annotations: the marked rectangles. */
  quads?: Quad[];
  /** Notes: where the icon sits. */
  point?: Point;
  /** Ink: one array of points per stroke. */
  strokes?: Point[][];
  contents?: string;
  /**
   * Where this came from. Annotations read out of the file are shown so the
   * reader displays what is actually there, but they must NOT be written back:
   * saving would then add a second copy of every mark on every save.
   */
  source: 'file' | 'new';
}

export const ANNOT_COLORS = [
  '#ffd54a', // yellow
  '#7ee081', // green
  '#68c9f2', // blue
  '#f78fb3', // pink
  '#c79bf5', // purple
] as const;

let counter = 0;
export function newId(): string {
  return `a${Date.now().toString(36)}${(counter++).toString(36)}`;
}

/** `#rrggbb` to the 0..1 components a PDF colour array wants. */
export function toRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 0.83, 0.29];
  const n = Number.parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * QuadPoints for one rectangle.
 *
 * The order is upper-left, upper-RIGHT, lower-left, lower-right -- not the
 * clockwise winding every instinct suggests. Getting it wrong renders a bowtie,
 * and no viewer reports an error, so this lives in one function rather than at
 * each call site.
 */
export function quadPoints(q: Quad): number[] {
  const left = q.x;
  const right = q.x + q.width;
  const top = q.y + q.height;
  const bottom = q.y;
  return [left, top, right, top, left, bottom, right, bottom];
}

/** The bounding box of a set of quads, which is the annotation's /Rect. */
export function boundsOf(quads: Quad[]): [number, number, number, number] {
  const x1 = Math.min(...quads.map((q) => q.x));
  const y1 = Math.min(...quads.map((q) => q.y));
  const x2 = Math.max(...quads.map((q) => q.x + q.width));
  const y2 = Math.max(...quads.map((q) => q.y + q.height));
  return [x1, y1, x2, y2];
}

const SUBTYPE: Record<Exclude<AnnotKind, 'note' | 'ink'>, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
};

/** Notes are drawn as a 22pt square, which is what viewers use for the icon. */
const NOTE_SIZE = 22;

/**
 * Write annotations into a document.
 *
 * `author` is stamped as /T so a viewer can group them, and goes in as UTF-16BE
 * (`PDFHexString.fromText`) because a Hebrew name in a PDFString would come out
 * as mojibake -- the same reason `electron/outline.ts` writes bookmark titles
 * that way.
 */
export async function writeAnnotations(
  pdfBytes: Uint8Array,
  annotations: Annotation[],
  author: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const pages = doc.getPages();

  for (const a of annotations) {
    if (a.source === 'file') continue;   // already in the document
    const page = pages[a.page - 1];
    if (!page) continue;

    const [r, g, b] = toRgb(a.color);
    const common: Record<string, unknown> = {
      Type: 'Annot',
      C: [r, g, b],
      // Printable, so the marks survive being printed or flattened elsewhere.
      F: 4,
      T: PDFHexString.fromText(author),
      M: PDFHexString.fromText(new Date().toISOString()),
    };
    if (a.contents) common.Contents = PDFHexString.fromText(a.contents);

    let dict: PDFDict | null = null;

    if (a.kind === 'note' && a.point) {
      dict = ctx.obj({
        ...common,
        Subtype: 'Text',
        Name: 'Comment',
        Rect: [a.point.x, a.point.y - NOTE_SIZE, a.point.x + NOTE_SIZE, a.point.y],
        Open: false,
      });
    } else if (a.kind === 'ink' && a.strokes?.length) {
      const all = a.strokes.flat();
      const xs = all.map((p) => p.x);
      const ys = all.map((p) => p.y);
      const pad = 3;
      dict = ctx.obj({
        ...common,
        Subtype: 'Ink',
        Rect: [Math.min(...xs) - pad, Math.min(...ys) - pad,
               Math.max(...xs) + pad, Math.max(...ys) + pad],
        // One flat [x y x y ...] array per stroke.
        InkList: a.strokes.map((s) => s.flatMap((p) => [p.x, p.y])),
        BS: { W: 2 },
      });
    } else if (a.quads?.length && a.kind in SUBTYPE) {
      dict = ctx.obj({
        ...common,
        Subtype: SUBTYPE[a.kind as keyof typeof SUBTYPE],
        Rect: boundsOf(a.quads),
        QuadPoints: a.quads.flatMap(quadPoints),
        // Highlights multiply against the page; the others are opaque strokes.
        ...(a.kind === 'highlight' ? { CA: 0.4 } : {}),
      });
    }

    if (!dict) continue;

    const ref = ctx.register(dict);
    let annots = page.node.get(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) {
      annots = ctx.obj([]);
      page.node.set(PDFName.of('Annots'), annots);
    }
    (annots as PDFArray).push(ref);
  }

  // Appearance streams are deliberately not generated. Every PDF viewer draws
  // text markup and notes from /QuadPoints and /Subtype, and an appearance we
  // synthesised would override the viewer's own and look worse.
  return doc.save({ updateFieldAppearances: false });
}

/* ---------------------------------------------------------------- reading */

/**
 * Annotations already in the file, so the reader shows what is there rather
 * than only what this session added.
 *
 * Read through pdf-lib rather than pdf.js because the two disagree about
 * coordinates for rotated pages, and everything else here is in PDF space.
 */
export async function readAnnotations(pdfBytes: Uint8Array): Promise<Annotation[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out: Annotation[] = [];

  doc.getPages().forEach((page, i) => {
    const annots = page.node.get(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;

    for (const entry of annots.asArray()) {
      const dict = entry instanceof PDFRef
        ? doc.context.lookupMaybe(entry, PDFDict)
        : (entry as PDFDict);
      if (!dict) continue;

      const subtype = dict.get(PDFName.of('Subtype'));
      const kind = ({
        Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strikeout',
      } as Record<string, AnnotKind>)[String(subtype).replace('/', '')];
      if (!kind) continue;

      const quadsRaw = dict.get(PDFName.of('QuadPoints'));
      if (!(quadsRaw instanceof PDFArray)) continue;
      const nums = quadsRaw.asArray().map((n) => Number((n as { asNumber?: () => number }).asNumber?.() ?? 0));

      const quads: Quad[] = [];
      for (let q = 0; q + 7 < nums.length; q += 8) {
        const xs = [nums[q], nums[q + 2], nums[q + 4], nums[q + 6]];
        const ys = [nums[q + 1], nums[q + 3], nums[q + 5], nums[q + 7]];
        quads.push({
          x: Math.min(...xs), y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        });
      }
      if (!quads.length) continue;

      out.push({ id: newId(), kind, page: i + 1, color: '#ffd54a', quads, contents: '', source: 'file' });
    }
  });

  return out;
}

/* ------------------------------------------------------------------- forms */

export interface FieldEdit {
  name: string;
  value: string;
}

/**
 * Apply form-field edits.
 *
 * The two-step dance here is not stylistic. pdf-lib's default `save()`
 * regenerates every field's appearance with Helvetica, which is WinAnsi-encoded
 * and THROWS on Hebrew rather than writing mojibake. So when any value needs
 * glyphs Helvetica does not have, a Unicode font is embedded, appearances are
 * regenerated against it explicitly, and the save is told not to do it again.
 *
 * The font is embedded UNSUBSETTED, unlike the OCR text layer which subsets: a
 * form field can be edited later in another viewer, which would then need glyphs
 * a subset built from today's value never included.
 */
export async function writeFormValues(
  pdfBytes: Uint8Array,
  edits: FieldEdit[],
  unicodeFontBytes: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = doc.getForm();

  const applied: string[] = [];
  for (const { name, value } of edits) {
    try {
      form.getTextField(name).setText(value);
      applied.push(name);
    } catch {
      // Not a text field, or no longer present: skip rather than failing the
      // whole save over one field.
    }
  }

  const needsUnicode = edits.some((e) => needsUnicodeFont(e.value));
  if (needsUnicode && unicodeFontBytes) {
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(unicodeFontBytes, { subset: false });
    for (const name of applied) {
      try { form.getTextField(name).updateAppearances(font); } catch { /* skip */ }
    }
    return doc.save({ updateFieldAppearances: false });
  }

  // No non-Latin values, so pdf-lib's own appearance pass is safe and correct.
  return doc.save();
}

/** True when any value needs glyphs the standard fonts do not carry. */
export function formNeedsUnicodeFont(edits: FieldEdit[]): boolean {
  return edits.some((e) => needsUnicodeFont(e.value));
}

// `rgb` is re-exported so callers can build swatches without importing pdf-lib.
export { rgb };
