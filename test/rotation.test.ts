import { describe, it, expect } from 'vitest';
import { rotationArgs, normaliseDegrees } from '../src/lib/rotation.js';

describe('rotationArgs', () => {
  it('remaps source pages to OUTPUT positions', () => {
    // Keep 6-10; rotating source page 6 must target output position 1.
    expect(rotationArgs([6, 7, 8, 9, 10], [{ page: 6, degrees: 90 }]))
      .toEqual(['--rotate=+90:1']);
    // Source page 8 is the 3rd kept page.
    expect(rotationArgs([6, 7, 8, 9, 10], [{ page: 8, degrees: 90 }]))
      .toEqual(['--rotate=+90:3']);
  });

  it('is the identity when every page is kept (the case that hides the bug)', () => {
    expect(rotationArgs([1, 2, 3, 4, 5], [{ page: 2, degrees: 90 }]))
      .toEqual(['--rotate=+90:2']);
  });

  it('groups pages by angle and collapses runs', () => {
    expect(rotationArgs([1, 2, 3, 4, 5], [
      { page: 1, degrees: 90 }, { page: 2, degrees: 90 },
      { page: 3, degrees: 90 }, { page: 5, degrees: 180 },
    ])).toEqual(['--rotate=+90:1-3', '--rotate=+180:5']);
  });

  it('ignores rotations on pages that are being removed', () => {
    expect(rotationArgs([1, 3], [{ page: 2, degrees: 90 }])).toEqual([]);
  });

  it('handles a non-contiguous selection', () => {
    // keep = [2,5,9] -> output positions 1,2,3
    expect(rotationArgs([2, 5, 9], [{ page: 5, degrees: 270 }]))
      .toEqual(['--rotate=+270:2']);
  });

  it('returns nothing when there are no rotations', () => {
    expect(rotationArgs([1, 2, 3], [])).toEqual([]);
  });
});

describe('normaliseDegrees', () => {
  it('wraps turns into 0/90/180/270', () => {
    expect(normaliseDegrees(0)).toBe(0);
    expect(normaliseDegrees(360)).toBe(0);
    expect(normaliseDegrees(450)).toBe(90);
    expect(normaliseDegrees(-90)).toBe(270);
    expect(normaliseDegrees(-450)).toBe(270);
  });
});
