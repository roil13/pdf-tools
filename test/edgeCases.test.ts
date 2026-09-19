/**
 * Degenerate inputs. None of these should be reachable through the UI, but they
 * are exactly what a malformed PDF or an unusual document produces, and the
 * failure mode should be a clear error rather than a crash or silent nonsense.
 */
import { describe, it, expect } from 'vitest';
import { parseRanges, formatRanges, complement, planSplit } from '../src/lib/pageRanges.js';
import { outputPages, toggleSelection, isReordered } from '../src/lib/selection.js';
import { safeName, uniquify, padIndex } from '../src/lib/safeName.js';
import { rotationArgs } from '../src/lib/rotation.js';
import { placeImage } from '../src/lib/imagesToPdf.js';
import { RangeParseError } from '../src/lib/errors.js';

describe('a zero-page document', () => {
  it('rejects any page reference rather than accepting it', () => {
    expect(() => parseRanges('1', 0)).toThrow(RangeParseError);
  });

  it('produces no output pages', () => {
    expect(complement([], 0)).toEqual([]);
    expect(outputPages([], new Set(), 'keep')).toEqual([]);
    expect(outputPages([], new Set(), 'all')).toEqual([]);
  });

  it('plans no split parts', () => {
    expect(planSplit('each', {}, 0)).toEqual([]);
    expect(planSplit('every', { size: 5 }, 0)).toEqual([]);
    expect(planSplit('points', {}, 0)).toEqual([]);
  });
});

describe('a chunk larger than the document', () => {
  it('yields a single part holding everything', () => {
    const parts = planSplit('every', { size: 100 }, 10);
    expect(parts).toHaveLength(1);
    expect(parts[0].pages).toHaveLength(10);
  });
});

describe('formatRanges with unusual input', () => {
  it('does not merge a repeated page into a run', () => {
    // Duplicates cannot come from the grid, but a hand-typed range can repeat.
    expect(formatRanges([1, 1, 2])).toBe('1,1-2');
  });

  it('preserves a descending order rather than silently sorting', () => {
    // qpdf honours the order, so reversing must survive to the argument list.
    expect(formatRanges([3, 2, 1])).toBe('3,2,1');
  });
});

describe('safeName with nothing usable', () => {
  it('falls back rather than producing an empty filename', () => {
    expect(safeName('...')).toBe('part');
    expect(safeName('   ')).toBe('part');
    expect(safeName('')).toBe('part');
  });

  it('numbers every repeat', () => {
    expect(uniquify(['a', 'a', 'a'])).toEqual(['a', 'a (2)', 'a (3)']);
  });

  it('pads sensibly even for a nonsense total', () => {
    expect(padIndex(1, 0)).toBe('1');
  });
});

describe('rotation with nothing kept', () => {
  it('emits no arguments rather than an empty range', () => {
    // An empty --rotate range would be a qpdf syntax error.
    expect(rotationArgs([], [{ page: 1, degrees: 90 }])).toEqual([]);
  });
});

describe('selection referring to a page not in the grid', () => {
  it('is a no-op on the visible pages', () => {
    const next = toggleSelection({
      pages: [1, 2], selected: new Set(), pageNum: 9, shift: false, anchor: null,
    });
    // It selects the page it was told to; outputPages then filters it out,
    // which is what keeps a stale selection from reaching qpdf.
    expect(outputPages([1, 2], next, 'keep')).toEqual([]);
  });

  it('shift-select with an anchor that is no longer displayed falls back to a plain toggle', () => {
    const next = toggleSelection({
      pages: [1, 2, 3], selected: new Set(), pageNum: 2, shift: true, anchor: 99,
    });
    expect([...next]).toEqual([2]);
  });
});

describe('isReordered', () => {
  it('treats an empty grid as unchanged', () => {
    expect(isReordered([])).toBe(false);
  });
});

describe('placeImage', () => {
  it('fit: the page is exactly the image, and the image fills it', () => {
    const p = placeImage({ width: 800, height: 600 }, 'fit', 0);
    expect(p).toMatchObject({ pageWidth: 800, pageHeight: 600, x: 0, y: 0, width: 800, height: 600 });
  });

  it('fit: clamps a page that would exceed the PDF maximum side', () => {
    // 30000 points is 416 inches; the limit is 200.
    const p = placeImage({ width: 30000, height: 2000 }, 'fit', 0);
    expect(p.pageWidth).toBeLessThanOrEqual(14400);
    expect(p.pageHeight).toBeLessThanOrEqual(14400);
    expect(p.pageWidth).toBeCloseTo(14400, 6);
    // The aspect ratio must survive, or the image is distorted.
    expect(p.pageWidth / p.pageHeight).toBeCloseTo(30000 / 2000, 6);
    // And it still fills the page.
    expect(p.width).toBeCloseTo(p.pageWidth, 6);
    expect(p.height).toBeCloseTo(p.pageHeight, 6);
  });

  it('fit: clamps on the tall side too', () => {
    const p = placeImage({ width: 2000, height: 30000 }, 'fit', 0);
    expect(p.pageHeight).toBeCloseTo(14400, 6);
    expect(p.pageWidth).toBeLessThan(14400);
  });

  it('fit: never produces a zero-sized page', () => {
    const p = placeImage({ width: 0, height: 0 }, 'fit', 0);
    expect(p.pageWidth).toBeGreaterThan(0);
    expect(p.pageHeight).toBeGreaterThan(0);
  });

  it('a4: picks landscape for a wide image and centres it', () => {
    const p = placeImage({ width: 2000, height: 1000 }, 'a4', 36);
    expect(p.pageWidth).toBeGreaterThan(p.pageHeight); // landscape
    // Centred: the gaps on each side are equal.
    expect(p.x * 2 + p.width).toBeCloseTo(p.pageWidth, 6);
    expect(p.y * 2 + p.height).toBeCloseTo(p.pageHeight, 6);
  });

  it('a4: picks portrait for a tall image and honours the margin', () => {
    const margin = 36;
    const p = placeImage({ width: 1000, height: 2000 }, 'a4', margin);
    expect(p.pageHeight).toBeGreaterThan(p.pageWidth); // portrait
    expect(p.width).toBeLessThanOrEqual(p.pageWidth - margin * 2 + 0.001);
    expect(p.height).toBeLessThanOrEqual(p.pageHeight - margin * 2 + 0.001);
  });

  it('a4: preserves the aspect ratio', () => {
    const p = placeImage({ width: 1600, height: 900 }, 'a4', 20);
    expect(p.width / p.height).toBeCloseTo(1600 / 900, 6);
  });

  it('a4: an absurd margin still leaves a drawable image', () => {
    const p = placeImage({ width: 1000, height: 1000 }, 'a4', 5000);
    expect(p.width).toBeGreaterThan(0);
    expect(p.height).toBeGreaterThan(0);
  });
});
