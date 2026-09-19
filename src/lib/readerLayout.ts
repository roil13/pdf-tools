/**
 * The reader's scroll arithmetic, kept pure so it can be tested without a DOM.
 *
 * A continuous-scroll viewer has to know where every page starts before it has
 * rendered any of them, or the scrollbar jumps around as pages resolve. All of
 * that is offsets and sums, which is exactly the kind of thing that is miserable
 * to debug through a browser and trivial to unit test.
 */

/** Page dimensions in PDF points, with any view rotation already applied. */
export interface PageSize {
  width: number;
  height: number;
}

export type ZoomMode =
  | { kind: 'fitWidth' }
  | { kind: 'fitPage' }
  | { kind: 'fixed'; scale: number };

export interface Layout {
  /** Top edge of each page, in CSS pixels from the top of the scroll content. */
  offsets: number[];
  /** Rendered height of each page, in CSS pixels. */
  heights: number[];
  /** Widest page, for centring and for the scroll container's width. */
  contentWidth: number;
  /** Total scrollable height including the gaps and the trailing margin. */
  totalHeight: number;
}

/**
 * Where every page sits at a given scale.
 *
 * Pages are laid out top to bottom with a fixed gap. The same gap is used above
 * the first page and below the last, so a document scrolled to either end has
 * symmetric breathing room.
 */
export function layoutPages(sizes: PageSize[], scale: number, gap: number): Layout {
  const offsets: number[] = [];
  const heights: number[] = [];
  let y = gap;
  let contentWidth = 0;

  for (const size of sizes) {
    const h = Math.round(size.height * scale);
    offsets.push(y);
    heights.push(h);
    y += h + gap;
    contentWidth = Math.max(contentWidth, Math.round(size.width * scale));
  }

  return { offsets, heights, contentWidth, totalHeight: y };
}

/**
 * Which pages to mount for a given scroll position, as an inclusive range.
 *
 * `overscan` is in pixels rather than pages deliberately: one page of overscan
 * means something very different at fit-page zoom than at 400%, and the cost we
 * are managing is pixels to rasterise, not components to mount.
 */
export function visibleRange(
  layout: Layout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): { first: number; last: number } {
  const n = layout.offsets.length;
  if (n === 0) return { first: 0, last: -1 };

  const top = scrollTop - overscan;
  const bottom = scrollTop + viewportHeight + overscan;

  let first = 0;
  let last = n - 1;
  for (let i = 0; i < n; i++) {
    if (layout.offsets[i] + layout.heights[i] >= top) { first = i; break; }
  }
  for (let i = first; i < n; i++) {
    if (layout.offsets[i] > bottom) { last = i - 1; break; }
  }
  return { first, last: Math.max(first, last) };
}

/**
 * The page the user would say they are on: the one under the middle of the
 * viewport.
 *
 * Using the midpoint rather than the top edge matters at fit-page zoom, where a
 * page boundary sitting one pixel below the top would otherwise report the next
 * page while the previous one still fills the screen.
 *
 * Returns a 1-indexed page number.
 */
export function pageAtScroll(
  layout: Layout, scrollTop: number, viewportHeight: number,
): number {
  const n = layout.offsets.length;
  if (n === 0) return 1;
  const mid = scrollTop + viewportHeight / 2;

  for (let i = 0; i < n; i++) {
    if (mid < layout.offsets[i] + layout.heights[i]) return i + 1;
  }
  return n;
}

/**
 * Scale for a zoom mode. `available` is the space inside the scroll container,
 * already less any padding.
 *
 * Fit-page uses the FIRST page rather than the current one on purpose: a scale
 * that changed as you scrolled past a landscape page would move the content
 * under the user's cursor for no reason they asked for.
 */
export function scaleFor(
  mode: ZoomMode,
  available: { width: number; height: number },
  first: PageSize | undefined,
): number {
  if (mode.kind === 'fixed') return mode.scale;
  if (!first || first.width <= 0 || first.height <= 0) return 1;

  const byWidth = available.width / first.width;
  if (mode.kind === 'fitWidth') return clampScale(byWidth);
  return clampScale(Math.min(byWidth, available.height / first.height));
}

/** Zoom limits. Below 10% text is unreadable; above 800% a page stops fitting in a bitmap. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The scroll position that puts a 1-indexed page at the top of the viewport. */
export function scrollToPage(layout: Layout, page: number, gap: number): number {
  const i = Math.min(Math.max(page, 1), layout.offsets.length) - 1;
  return Math.max(0, layout.offsets[i] - gap);
}

/**
 * Keep the point under the cursor fixed while zooming.
 *
 * Without this, ctrl+wheel zoom walks the document away from whatever the user
 * was looking at, which is the single thing that makes a viewer feel broken.
 */
export function scrollAfterZoom(
  before: Layout, after: Layout, scrollTop: number, anchorY: number,
): number {
  const ratio = before.totalHeight > 0 ? after.totalHeight / before.totalHeight : 1;
  return Math.max(0, (scrollTop + anchorY) * ratio - anchorY);
}
