import {
  PDFDocument, PDFFont, PDFPage, StandardFonts, PDFOperator, PDFOperatorNames, PDFNumber,
  pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextMatrix, showText, setTextRenderingMode, TextRenderingMode,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { OcrWord } from './ocr.js';

/** Maps a point in the rendered image back into unrotated PDF user space. */
export type ToPdfPoint = (x: number, y: number) => [number, number];

export interface PageWords {
  /** 1-indexed page in the document being written. */
  pageNum: number;
  words: OcrWord[];
  toPdfPoint: ToPdfPoint;
  /** Scale the page was rendered at: image pixels per PDF point. */
  scale: number;
  /** The page's /Rotate value, so the text runs the same way the glyphs do. */
  rotation: number;
}

/** Words below this are usually noise, and wrong text is worse than none. */
const MIN_CONFIDENCE = 40;

/**
 * True when a word needs a Unicode font. Latin-1 is covered by the
 * standard-14 Helvetica; anything above it (Hebrew, for one) is not.
 * A code-point test rather than a regex, so no raw bytes end up in source.
 */
export function needsUnicodeFont(text: string): boolean {
  for (const ch of text) if (ch.codePointAt(0)! > 0xff) return true;
  return false;
}

/**
 * Write an invisible, selectable text layer onto an existing PDF.
 *
 * The original page content is never touched -- operators are appended, so the
 * scan itself is untouched and everything else in the document (bookmarks, form
 * fields, attachments) survives.
 */
export async function addTextLayer(
  pdfBytes: Uint8Array,
  pages: PageWords[],
  hebrewFontBytes: Uint8Array | null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);

  const latin = await doc.embedFont(StandardFonts.Helvetica);
  // Only embed the Hebrew face if a non-Latin word actually turns up, so a
  // purely English document pays nothing for it.
  const needsUnicode = pages.some((p) => p.words.some((w) => needsUnicodeFont(w.text)));
  const unicode = needsUnicode && hebrewFontBytes
    ? await doc.embedFont(hebrewFontBytes, { subset: true })
    : null;

  const docPages = doc.getPages();

  for (const page of pages) {
    const target = docPages[page.pageNum - 1];
    if (!target) continue;
    drawWords(target, page, latin, unicode);
  }

  // Leave any AcroForm exactly as it was.
  return doc.save({ updateFieldAppearances: false });
}

function drawWords(
  page: PDFPage,
  info: PageWords,
  latin: PDFFont,
  unicode: PDFFont | null,
): void {
  const latinKey = page.node.newFontDictionary('OCRLatin', latin.ref);
  const unicodeKey = unicode ? page.node.newFontDictionary('OCRUni', unicode.ref) : null;

  // Page rotation is applied at display time, so glyphs drawn in user space
  // must be turned by the same amount to run alongside the visible text.
  const theta = ((info.rotation % 360) + 360) % 360 * (Math.PI / 180);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  for (const word of info.words) {
    if (word.confidence < MIN_CONFIDENCE) continue;

    const nonLatin = needsUnicodeFont(word.text);
    const font = nonLatin ? unicode : latin;
    const key = nonLatin ? unicodeKey : latinKey;
    if (!font || !key) continue; // no font can represent this word

    // Bottom-left of the box in image space maps to the text origin.
    const [x, y] = info.toPdfPoint(word.x0, word.y1);

    const heightPt = (word.y1 - word.y0) / info.scale;
    const widthPt = (word.x1 - word.x0) / info.scale;
    if (heightPt <= 0 || widthPt <= 0) continue;

    // Tesseract boxes cover ascender to descender; ~0.8 approximates the em size
    // that a renderer would use for glyphs of that height.
    const size = heightPt * 0.8;

    let encoded;
    try {
      encoded = font.encodeText(word.text);
    } catch {
      continue; // a glyph the font cannot represent
    }

    // Stretch the invisible word to match the box, so selection highlights and
    // find-in-page rectangles line up with the glyphs the user can see.
    const natural = safeWidth(font, word.text, size);
    const scalePct = natural > 0 ? clamp((widthPt / natural) * 100, 10, 1000) : 100;

    page.pushOperators(
      pushGraphicsState(),
      beginText(),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setFontAndSize(key, size),
      PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(scalePct)]),
      setTextMatrix(cos, sin, -sin, cos, x, y),
      showText(encoded),
      endText(),
      popGraphicsState(),
    );
  }
}

function safeWidth(font: PDFFont, text: string, size: number): number {
  try { return font.widthOfTextAtSize(text, size); } catch { return 0; }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
