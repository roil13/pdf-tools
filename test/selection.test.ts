import { describe, it, expect } from 'vitest';
import { toggleSelection, isReordered, outputPages, nextMode } from '../src/lib/selection.js';

const natural = [1, 2, 3, 4, 5, 6, 7, 8];
const shuffled = [8, 1, 2, 3, 4, 5, 6, 7];
const S = (...n: number[]) => new Set(n);
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe('toggleSelection', () => {
  it('toggles a single page on and off', () => {
    const on = toggleSelection({ pages: natural, selected: S(), pageNum: 3, shift: false, anchor: null });
    expect(sorted(on)).toEqual([3]);
    const off = toggleSelection({ pages: natural, selected: on, pageNum: 3, shift: false, anchor: null });
    expect(sorted(off)).toEqual([]);
  });

  it('shift-selects a run in natural order', () => {
    const r = toggleSelection({ pages: natural, selected: S(2), pageNum: 5, shift: true, anchor: 2 });
    expect(sorted(r)).toEqual([2, 3, 4, 5]);
  });

  it('shift-selects backwards too', () => {
    const r = toggleSelection({ pages: natural, selected: S(6), pageNum: 3, shift: true, anchor: 6 });
    expect(sorted(r)).toEqual([3, 4, 5, 6]);
  });

  it('spans what is VISIBLE between the tiles after a rearrange', () => {
    // Grid reads 8,1,2,3,... Clicking tile 8 then shift-clicking tile 2 must
    // take the three tiles the user can see, not pages 2 through 8.
    const r = toggleSelection({ pages: shuffled, selected: S(8), pageNum: 2, shift: true, anchor: 8 });
    expect(sorted(r)).toEqual([1, 2, 8]);
  });

  it('does not select by page number after a rearrange', () => {
    const r = toggleSelection({ pages: shuffled, selected: S(8), pageNum: 2, shift: true, anchor: 8 });
    // The by-number reading would have swept in 3..7 as well.
    for (const p of [3, 4, 5, 6, 7]) expect(r.has(p)).toBe(false);
  });

  it('shift-clicking a selected page clears the run', () => {
    const r = toggleSelection({
      pages: natural, selected: S(2, 3, 4, 5), pageNum: 5, shift: true, anchor: 2,
    });
    expect(sorted(r)).toEqual([]);
  });

  it('falls back to a plain toggle when there is no anchor', () => {
    const r = toggleSelection({ pages: natural, selected: S(), pageNum: 4, shift: true, anchor: null });
    expect(sorted(r)).toEqual([4]);
  });
});

describe('isReordered', () => {
  it('recognises natural and rearranged order', () => {
    expect(isReordered([1, 2, 3])).toBe(false);
    expect(isReordered([2, 1, 3])).toBe(true);
    expect(isReordered([3, 2, 1])).toBe(true);
    expect(isReordered([])).toBe(false);
  });
});

describe('outputPages', () => {
  it('all: saves the whole document in grid order, selection ignored', () => {
    expect(outputPages(shuffled, S(), 'all')).toEqual(shuffled);
    expect(outputPages(shuffled, S(3, 4), 'all')).toEqual(shuffled);
  });

  it('keeps the grid order, not ascending order', () => {
    expect(outputPages(shuffled, S(8, 1, 2), 'keep')).toEqual([8, 1, 2]);
  });

  it('removes selected pages while preserving order', () => {
    expect(outputPages(shuffled, S(3, 4), 'remove')).toEqual([8, 1, 2, 5, 6, 7]);
  });

  it('handles nothing selected in each mode', () => {
    expect(outputPages(natural, S(), 'keep')).toEqual([]);
    expect(outputPages(natural, S(), 'remove')).toEqual(natural);
    expect(outputPages(natural, S(), 'all')).toEqual(natural);
  });
});

describe('nextMode', () => {
  it('switches to keep as soon as something is selected', () => {
    expect(nextMode('all', 1)).toBe('keep');
  });

  it('falls back to all when the selection is cleared', () => {
    expect(nextMode('keep', 0)).toBe('all');
    expect(nextMode('remove', 0)).toBe('all');
  });

  it('leaves a deliberate keep/remove choice alone', () => {
    expect(nextMode('remove', 3)).toBe('remove');
    expect(nextMode('keep', 3)).toBe('keep');
  });
});
