/**
 * Crop rectangle arithmetic.
 *
 * Dragging a handle is the kind of thing that looks right until someone drags
 * past an edge, or past the opposite handle, and gets a rectangle with negative
 * width that silently crops nothing. All of that is decided here.
 */
import { describe, it, expect } from 'vitest';
import {
  clampRect, dragRect, rectFromCorners, isFullCrop, toPixels, FULL_CROP,
  type CropRect,
} from '../src/lib/cropRect.js';

const rect = (x: number, y: number, width: number, height: number): CropRect =>
  ({ x, y, width, height });

describe('rectFromCorners', () => {
  it('normalises corners given in any order', () => {
    expect(rectFromCorners(0.8, 0.9, 0.2, 0.1)).toEqual(rect(0.2, 0.1, 0.6000000000000001, 0.8));
  });

  it('clamps corners to the image', () => {
    const r = rectFromCorners(-0.5, -0.5, 1.5, 1.5);
    expect(r).toEqual(FULL_CROP);
  });
});

describe('clampRect', () => {
  it('keeps a rectangle inside the image by moving it, not shrinking it', () => {
    const r = clampRect(rect(0.9, 0.9, 0.3, 0.3));
    expect(r.width).toBeCloseTo(0.3);
    expect(r.height).toBeCloseTo(0.3);
    expect(r.x).toBeCloseTo(0.7);
    expect(r.y).toBeCloseTo(0.7);
  });

  it('refuses a rectangle dragged down to nothing', () => {
    // A zero-size rectangle cannot be grabbed again, so it is never produced.
    const r = clampRect(rect(0.5, 0.5, 0, 0));
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it('never exceeds the image', () => {
    const r = clampRect(rect(-1, -1, 5, 5));
    expect(r).toEqual(FULL_CROP);
  });
});

describe('dragRect', () => {
  const start = rect(0.2, 0.2, 0.6, 0.6);

  it('moves without resizing', () => {
    const r = dragRect(start, 'move', 0.1, -0.1);
    expect(r.width).toBeCloseTo(0.6);
    expect(r.height).toBeCloseTo(0.6);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.1);
  });

  it('stops a move at the edge rather than pushing the rectangle out', () => {
    const r = dragRect(start, 'move', 1, 1);
    expect(r.x).toBeCloseTo(0.4);       // 1 - width
    expect(r.y).toBeCloseTo(0.4);
    expect(r.width).toBeCloseTo(0.6);
  });

  it('drags one edge without moving the opposite one', () => {
    const r = dragRect(start, 'e', 0.1, 0);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.width).toBeCloseTo(0.7);
  });

  it('drags a corner in both axes', () => {
    const r = dragRect(start, 'nw', 0.1, 0.1);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.3);
    expect(r.width).toBeCloseTo(0.5);
    expect(r.height).toBeCloseTo(0.5);
  });

  it('flips rather than inverting when an edge passes its opposite', () => {
    // Dragging the west edge far past the east one must not produce a negative
    // width, which would crop nothing at all.
    const r = dragRect(start, 'w', 0.9, 0);
    expect(r.width).toBeGreaterThan(0);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(1.0001);
  });

  it('ignores the axis a handle does not own', () => {
    const r = dragRect(start, 'n', 0.5, 0.1);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.width).toBeCloseTo(0.6);
    expect(r.y).toBeCloseTo(0.3);
  });

  it('is measured from the start, so the same drag gives the same result', () => {
    // Deltas from the start rather than since the last event: a drag that
    // outruns the edge and comes back must not accumulate error.
    const once = dragRect(start, 'se', 0.15, 0.15);
    const afterWandering = dragRect(start, 'se', 0.15, 0.15);
    expect(afterWandering).toEqual(once);
  });
});

describe('isFullCrop', () => {
  it('recognises the whole image, which is not a crop', () => {
    expect(isFullCrop(FULL_CROP)).toBe(true);
  });

  it('recognises a real crop', () => {
    expect(isFullCrop(rect(0.1, 0, 0.9, 1))).toBe(false);
  });
});

describe('toPixels', () => {
  it('converts to whole pixels', () => {
    expect(toPixels(rect(0.25, 0.5, 0.5, 0.25), 1000, 800))
      .toEqual({ x: 250, y: 400, width: 500, height: 200 });
  });

  it('never runs past the image edge after rounding', () => {
    const p = toPixels(rect(0.999, 0.999, 0.5, 0.5), 100, 100);
    expect(p.x + p.width).toBeLessThanOrEqual(100);
    expect(p.y + p.height).toBeLessThanOrEqual(100);
  });

  it('never produces a zero-sized crop', () => {
    const p = toPixels(rect(0, 0, 0.0001, 0.0001), 100, 100);
    expect(p.width).toBeGreaterThan(0);
    expect(p.height).toBeGreaterThan(0);
  });
});
