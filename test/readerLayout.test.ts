/**
 * The reader's scroll arithmetic. These are the rules that decide which pages
 * get rasterised, so an off-by-one here is either a blank page or a document
 * that renders every page it scrolls past.
 */
import { describe, it, expect } from 'vitest';
import {
  layoutPages, visibleRange, pageAtScroll, scaleFor, clampScale,
  scrollToPage, scrollAfterZoom, MIN_SCALE, MAX_SCALE,
  type PageSize,
} from '../src/lib/readerLayout.js';
import { RenderCache, pageKey } from '../src/lib/renderCache.js';
import { findInText, matchNearPage } from '../src/reader/search.js';

const A4: PageSize = { width: 595, height: 842 };
const LANDSCAPE: PageSize = { width: 842, height: 595 };
const GAP = 16;

describe('layoutPages', () => {
  it('stacks pages with a gap above the first and below the last', () => {
    const l = layoutPages([A4, A4], 1, GAP);
    expect(l.offsets).toEqual([16, 874]);          // 16, then 16 + 842 + 16
    expect(l.heights).toEqual([842, 842]);
    expect(l.totalHeight).toBe(1732);              // 874 + 842 + 16
  });

  it('reports the widest page, not the first', () => {
    expect(layoutPages([A4, LANDSCAPE], 1, GAP).contentWidth).toBe(842);
  });

  it('scales both axes', () => {
    const l = layoutPages([A4], 2, GAP);
    expect(l.heights[0]).toBe(1684);
    expect(l.contentWidth).toBe(1190);
  });

  it('handles an empty document without producing NaN', () => {
    const l = layoutPages([], 1, GAP);
    expect(l.offsets).toEqual([]);
    expect(l.totalHeight).toBe(GAP);
  });
});

describe('visibleRange', () => {
  const layout = layoutPages(Array(100).fill(A4), 1, GAP);

  it('mounts only what is on screen, plus the overscan', () => {
    const { first, last } = visibleRange(layout, 0, 800, 0);
    expect(first).toBe(0);
    expect(last).toBe(0);
  });

  it('includes a page that is only partly visible at the top', () => {
    // Scrolled so page 2 (index 1) is half off the top.
    const { first } = visibleRange(layout, layout.offsets[1] + 400, 800, 0);
    expect(first).toBe(1);
  });

  it('grows the range with overscan', () => {
    const tight = visibleRange(layout, 5000, 800, 0);
    const loose = visibleRange(layout, 5000, 800, 2000);
    expect(loose.first).toBeLessThan(tight.first);
    expect(loose.last).toBeGreaterThan(tight.last);
  });

  it('never runs past the end of the document', () => {
    const { last } = visibleRange(layout, layout.totalHeight, 800, 5000);
    expect(last).toBe(99);
  });

  it('returns an empty range for an empty document', () => {
    expect(visibleRange(layoutPages([], 1, GAP), 0, 800, 0)).toEqual({ first: 0, last: -1 });
  });
});

describe('pageAtScroll', () => {
  const layout = layoutPages([A4, A4, A4], 1, GAP);

  it('reports the page under the middle of the viewport, not the top edge', () => {
    // Top edge is one pixel into page 2, but page 1 still fills the screen.
    const scrollTop = layout.offsets[1] - 799;
    expect(pageAtScroll(layout, scrollTop, 800)).toBe(1);
  });

  it('advances once the next page owns the middle', () => {
    expect(pageAtScroll(layout, layout.offsets[1], 800)).toBe(2);
  });

  it('clamps to the last page past the end', () => {
    expect(pageAtScroll(layout, 1e6, 800)).toBe(3);
  });

  it('is 1-indexed', () => {
    expect(pageAtScroll(layout, 0, 800)).toBe(1);
  });
});

describe('scaleFor', () => {
  it('fits the width', () => {
    expect(scaleFor({ kind: 'fitWidth' }, { width: 1190, height: 400 }, A4)).toBeCloseTo(2);
  });

  it('fits the page by whichever axis binds', () => {
    // Width allows 2x, height only allows 1x, so 1x wins.
    expect(scaleFor({ kind: 'fitPage' }, { width: 1190, height: 842 }, A4)).toBeCloseTo(1);
  });

  it('passes a fixed scale through', () => {
    expect(scaleFor({ kind: 'fixed', scale: 1.75 }, { width: 100, height: 100 }, A4)).toBe(1.75);
  });

  it('falls back to 1 before any page has been measured', () => {
    expect(scaleFor({ kind: 'fitWidth' }, { width: 1000, height: 1000 }, undefined)).toBe(1);
  });

  it('does not divide by a zero-sized page', () => {
    const s = scaleFor({ kind: 'fitWidth' }, { width: 1000, height: 1000 }, { width: 0, height: 0 });
    expect(Number.isFinite(s)).toBe(true);
  });

  it('clamps a fit scale into the usable range', () => {
    const huge = scaleFor({ kind: 'fitWidth' }, { width: 1e6, height: 1e6 }, A4);
    expect(huge).toBe(MAX_SCALE);
  });
});

describe('clampScale', () => {
  it('holds the zoom between its limits', () => {
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });
});

describe('scrollToPage', () => {
  const layout = layoutPages([A4, A4, A4], 1, GAP);

  it('puts the requested page at the top', () => {
    expect(scrollToPage(layout, 2, GAP)).toBe(layout.offsets[1] - GAP);
  });

  it('clamps out-of-range requests rather than scrolling into nothing', () => {
    expect(scrollToPage(layout, 0, GAP)).toBe(0);
    expect(scrollToPage(layout, 999, GAP)).toBe(layout.offsets[2] - GAP);
  });
});

describe('scrollAfterZoom', () => {
  it('keeps the point under the cursor fixed', () => {
    const before = layoutPages(Array(10).fill(A4), 1, GAP);
    const after = layoutPages(Array(10).fill(A4), 2, GAP);
    // Looking at content 1000px down, cursor 300px into the viewport.
    const next = scrollAfterZoom(before, after, 1000, 300);
    // That content is now at roughly twice the offset, minus the cursor offset.
    const ratio = after.totalHeight / before.totalHeight;
    expect(next).toBeCloseTo(1300 * ratio - 300, 0);
  });

  it('never scrolls above the top', () => {
    const before = layoutPages([A4], 2, GAP);
    const after = layoutPages([A4], 0.5, GAP);
    expect(scrollAfterZoom(before, after, 0, 0)).toBe(0);
  });
});

/* ------------------------------------------------------------ render cache */

/** A stand-in for ImageBitmap: the cache only needs dimensions and close(). */
function fakeBitmap(w: number, h: number) {
  const b = { width: w, height: h, closed: false, close() { this.closed = true; } };
  return b as unknown as ImageBitmap & { closed: boolean };
}

describe('RenderCache', () => {
  it('returns what it stored', () => {
    const c = new RenderCache(10 * 1024 * 1024);
    const b = fakeBitmap(100, 100);
    c.set('a', b);
    expect(c.get('a')).toBe(b);
  });

  it('evicts the least recently used once over budget, and frees it', () => {
    // Each bitmap is 100*100*4 = 40,000 bytes. Budget fits two.
    const c = new RenderCache(90_000);
    const a = fakeBitmap(100, 100);
    const b = fakeBitmap(100, 100);
    const d = fakeBitmap(100, 100);
    c.set('a', a); c.set('b', b); c.set('d', d);

    expect(c.get('a')).toBeUndefined();
    expect(a.closed).toBe(true);           // actually released, not just dropped
    expect(c.get('b')).toBe(b);
    expect(c.get('d')).toBe(d);
  });

  it('counts a read as a use, so the untouched entry is the one that goes', () => {
    const c = new RenderCache(90_000);
    const a = fakeBitmap(100, 100);
    const b = fakeBitmap(100, 100);
    c.set('a', a); c.set('b', b);
    c.get('a');                            // a is now the most recent
    c.set('d', fakeBitmap(100, 100));
    expect(c.get('a')).toBe(a);
    expect(c.get('b')).toBeUndefined();
  });

  it('still serves a single page larger than the whole budget', () => {
    const c = new RenderCache(1);
    const big = fakeBitmap(4000, 4000);
    c.set('big', big);
    expect(c.get('big')).toBe(big);
    expect(big.closed).toBe(false);
  });

  it('replacing a key frees the old bitmap rather than leaking it', () => {
    const c = new RenderCache(10 * 1024 * 1024);
    const old = fakeBitmap(100, 100);
    c.set('a', old);
    c.set('a', fakeBitmap(100, 100));
    expect(old.closed).toBe(true);
    expect(c.stats.count).toBe(1);
    expect(c.stats.bytes).toBe(40_000);
  });

  it('drops one document without touching another', () => {
    const c = new RenderCache(10 * 1024 * 1024);
    const mine = fakeBitmap(10, 10);
    const theirs = fakeBitmap(10, 10);
    c.set(pageKey('docA', 1, 1, 0), mine);
    c.set(pageKey('docB', 1, 1, 0), theirs);
    c.dropDocument('docA');
    expect(c.get(pageKey('docA', 1, 1, 0))).toBeUndefined();
    expect(mine.closed).toBe(true);
    expect(c.get(pageKey('docB', 1, 1, 0))).toBe(theirs);
  });
});

describe('pageKey', () => {
  it('separates scale, rotation and document', () => {
    expect(pageKey('d', 1, 1, 0)).not.toBe(pageKey('d', 1, 1, 90));
    expect(pageKey('d', 1, 1, 0)).not.toBe(pageKey('d', 2, 1, 0));
    expect(pageKey('d', 1, 1, 0)).not.toBe(pageKey('e', 1, 1, 0));
  });

  it('quantises scale, so a fit-width recompute is still a cache hit', () => {
    expect(pageKey('d', 1, 1.2345678, 0)).toBe(pageKey('d', 1, 1.2345999, 0));
  });
});

/* ----------------------------------------------------------------- search */

describe('findInText', () => {
  it('finds every occurrence, case-insensitively', () => {
    const hits = findInText('Total total TOTAL', 'total');
    expect(hits.map((h) => h.start)).toEqual([0, 6, 12]);
  });

  it('treats the query as literal text, not a pattern', () => {
    // A reader's find box should find a full stop when you type one.
    expect(findInText('a.b axb', '.')).toEqual([{ page: 0, start: 1, end: 2 }]);
    expect(findInText('price (net)', '(net)')).toHaveLength(1);
  });

  it('does not report overlapping matches twice', () => {
    // 'aaaa' contains 'aa' at 0, 1 and 2; reporting all three would make
    // "3 of 3" step over the same characters repeatedly.
    expect(findInText('aaaa', 'aa').map((h) => h.start)).toEqual([0, 2]);
  });

  it('returns nothing for an empty query rather than matching everywhere', () => {
    expect(findInText('anything', '')).toEqual([]);
  });

  it('finds Hebrew', () => {
    const hits = findInText('שלום עולם שלום', 'שלום');
    expect(hits).toHaveLength(2);
  });

  it('reports offsets that slice back to the query', () => {
    const text = 'the quick brown fox';
    const [hit] = findInText(text, 'brown');
    expect(text.slice(hit.start, hit.end)).toBe('brown');
  });
});

describe('matchNearPage', () => {
  const matches = [
    { page: 2, start: 0, end: 1 },
    { page: 5, start: 0, end: 1 },
    { page: 9, start: 0, end: 1 },
  ];

  it('starts at the first match at or after the current page', () => {
    expect(matchNearPage(matches, 5)).toBe(1);
    expect(matchNearPage(matches, 6)).toBe(2);
  });

  it('wraps to the first match when the viewport is past them all', () => {
    expect(matchNearPage(matches, 99)).toBe(0);
  });

  it('handles an empty result set', () => {
    expect(matchNearPage([], 3)).toBe(0);
  });
});
