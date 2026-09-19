/**
 * Full-text search across a document.
 *
 * Two halves that look similar and are not:
 *
 * - FINDING matches needs no DOM. It reads `getTextContent()` for every page,
 *   including pages that were never scrolled to, so the hit count is the real
 *   one rather than "however many pages happen to be mounted".
 * - DRAWING a match needs the DOM, and reads it rather than recomputing it. The
 *   text layer has already positioned a span per text item; a `Range` over those
 *   spans yields exact rectangles, and gets page rotation, zoom and right-to-left
 *   runs right for free. Deriving rectangles from the text matrices instead means
 *   reimplementing what the browser just did, and getting it subtly wrong.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface Match {
  /** 1-indexed. */
  page: number;
  /** Character offsets into the page's flattened text. */
  start: number;
  end: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchHit {
  match: Match;
  rects: Rect[];
}

/**
 * One text item's contribution to a page's flattened text.
 *
 * `divIndex` is null for the synthetic separators inserted at line ends: they
 * exist so that a line break reads as a word boundary rather than gluing the
 * last word of one line to the first of the next, but they correspond to no span
 * and so cannot be highlighted.
 */
interface Segment {
  divIndex: number | null;
  text: string;
}

export interface PageText {
  /** Every segment concatenated -- what matches are found in. */
  text: string;
  segments: Segment[];
  /** Start offset of each segment within `text`. */
  offsets: number[];
}

/** Flatten a page's text content, remembering which span each run came from. */
export async function readPageText(
  doc: PDFDocumentProxy, pageNum: number,
): Promise<PageText> {
  const page = await doc.getPage(pageNum);
  const content = await page.getTextContent();

  const segments: Segment[] = [];
  const offsets: number[] = [];
  let text = '';
  let divIndex = 0;

  for (const item of content.items) {
    if (!('str' in item)) continue;      // a marked-content boundary, not text
    offsets.push(text.length);
    segments.push({ divIndex, text: item.str });
    text += item.str;
    divIndex++;

    if (item.hasEOL) {
      offsets.push(text.length);
      segments.push({ divIndex: null, text: ' ' });
      text += ' ';
    }
  }

  return { text, segments, offsets };
}

/**
 * Case-insensitive literal search. Deliberately not a regex: a reader's find box
 * takes whatever the user typed, and `.` or `(` should find those characters.
 */
export function findInText(text: string, query: string): Match[] {
  if (!query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: Match[] = [];

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    out.push({ page: 0, start: at, end: at + needle.length });
    // Advance past this match so overlapping occurrences are not reported twice.
    from = at + needle.length;
  }
  return out;
}

/**
 * Scan the whole document.
 *
 * Yields to the event loop between pages: a 500-page search is otherwise a
 * multi-second freeze with no way to cancel, and the abort signal would never be
 * observed because nothing else gets to run.
 */
export async function searchDocument(
  doc: PDFDocumentProxy,
  query: string,
  signal: AbortSignal,
  onProgress?: (page: number, total: number) => void,
): Promise<Match[]> {
  const out: Match[] = [];
  if (!query.trim()) return out;

  for (let page = 1; page <= doc.numPages; page++) {
    if (signal.aborted) return out;
    const { text } = await readPageText(doc, page);
    for (const m of findInText(text, query)) out.push({ ...m, page });
    onProgress?.(page, doc.numPages);
    // One macrotask per page keeps the UI responsive and lets abort land.
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/**
 * Rectangles for one match, relative to the top-left of the page element.
 *
 * Returns nothing when the match falls entirely in synthetic separators, or when
 * the text layer has not rendered the spans yet -- both are transient states, not
 * errors.
 */
export function rectsForMatch(
  pageEl: HTMLElement,
  textDivs: HTMLElement[],
  pageText: PageText,
  match: Match,
): Rect[] {
  const base = pageEl.getBoundingClientRect();
  const rects: Rect[] = [];

  pageText.segments.forEach((seg, i) => {
    if (seg.divIndex === null) return;
    const segStart = pageText.offsets[i];
    const segEnd = segStart + seg.text.length;
    if (segEnd <= match.start || segStart >= match.end) return;

    const div = textDivs[seg.divIndex];
    const node = div?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;

    const from = Math.max(0, match.start - segStart);
    const to = Math.min(seg.text.length, match.end - segStart);
    if (to <= from) return;

    const range = document.createRange();
    try {
      range.setStart(node, from);
      range.setEnd(node, to);
    } catch {
      // The span's text can differ in length from the item string when pdf.js
      // normalises; skip rather than throwing mid-render.
      return;
    }

    for (const r of range.getClientRects()) {
      if (r.width <= 0 || r.height <= 0) continue;
      rects.push({
        x: r.left - base.left,
        y: r.top - base.top,
        width: r.width,
        height: r.height,
      });
    }
    range.detach();
  });

  return rects;
}

/** Index of the first match at or after `page`, for "find next" from the viewport. */
export function matchNearPage(matches: Match[], page: number): number {
  const at = matches.findIndex((m) => m.page >= page);
  return at < 0 ? 0 : at;
}
