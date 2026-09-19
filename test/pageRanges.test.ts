import { describe, it, expect } from 'vitest';
import { parseRanges, formatRanges, complement, planSplit } from '../src/lib/pageRanges.js';
import { RangeParseError } from '../src/lib/errors.js';
import { en } from '../src/i18n/strings.js';
import { resolve } from '../src/i18n/t.js';

/** Assert the key AND the vars, then that it renders in both languages. */
function expectRangeError(fn: () => unknown, key: string, vars?: Record<string, unknown>) {
  let caught: unknown;
  try { fn(); } catch (err) { caught = err; }
  expect(caught).toBeInstanceOf(RangeParseError);
  const e = caught as RangeParseError;
  expect(e.messageKey).toBe(key);
  if (vars) expect(e.vars).toMatchObject(vars);
  // A key with no entry, or a var the wording does not use, would surface here.
  const text = resolve(en[e.messageKey], 'en', e.vars);
  expect(text).not.toMatch(/\{\w+\}/);
}

describe('parseRanges', () => {
  it('parses singles, runs and mixed input', () => {
    expect(parseRanges('1-3, 5, 8-10', 12)).toEqual([1, 2, 3, 5, 8, 9, 10]);
    expect(parseRanges('7', 10)).toEqual([7]);
  });

  it('tolerates messy whitespace and separators', () => {
    expect(parseRanges('  1 - 3 ,,  5 ; 6  ', 10)).toEqual([1, 2, 3, 5, 6]);
  });

  it('accepts en dash and .. as range separators', () => {
    expect(parseRanges('2–4', 10)).toEqual([2, 3, 4]);
    expect(parseRanges('2..4', 10)).toEqual([2, 3, 4]);
  });

  it('collapses duplicates and sorts', () => {
    expect(parseRanges('5,1-3,2,5', 10)).toEqual([1, 2, 3, 5]);
  });

  it('returns empty for empty input', () => {
    expect(parseRanges('', 10)).toEqual([]);
    expect(parseRanges('   ', 10)).toEqual([]);
  });

  it('rejects out-of-range pages, naming the count and the bad page', () => {
    expectRangeError(() => parseRanges('11', 10), 'range.outOfRange', { n: 10, page: 11 });
    expectRangeError(() => parseRanges('0', 10), 'range.startsAtOne');
  });

  it('rejects backwards ranges and suggests the corrected one', () => {
    expectRangeError(() => parseRanges('9-4', 10), 'range.backwards', { from: 4, to: 9 });
  });

  it('rejects nonsense, quoting the part that failed', () => {
    expectRangeError(() => parseRanges('abc', 10), 'range.notARange', { part: 'abc' });
  });
});

describe('formatRanges', () => {
  it('collapses consecutive runs', () => {
    expect(formatRanges([1, 2, 3, 5])).toBe('1-3,5');
    expect(formatRanges([1, 2, 3, 4])).toBe('1-4');
    expect(formatRanges([2, 4, 6])).toBe('2,4,6');
    expect(formatRanges([7])).toBe('7');
    expect(formatRanges([])).toBe('');
  });

  it('round-trips with parseRanges', () => {
    const pages = parseRanges('1-3, 5, 8-10', 12);
    expect(parseRanges(formatRanges(pages), 12)).toEqual(pages);
  });

  it('preserves a deliberately reordered selection', () => {
    // qpdf honours "3,1,2" as an output ordering, so we must not sort here.
    expect(formatRanges([3, 1, 2])).toBe('3,1-2');
  });
});

describe('complement', () => {
  it('returns the pages not selected', () => {
    expect(complement([2, 4], 5)).toEqual([1, 3, 5]);
    expect(complement([], 3)).toEqual([1, 2, 3]);
    expect(complement([1, 2, 3], 3)).toEqual([]);
  });
});

describe('planSplit', () => {
  it('each: one part per page', () => {
    const parts = planSplit('each', {}, 3);
    expect(parts.map((p) => p.pages)).toEqual([[1], [2], [3]]);
  });

  it('every: fixed-size chunks with a short tail', () => {
    const parts = planSplit('every', { size: 4 }, 10);
    expect(parts.map((p) => p.pages)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]]);
    expect(parts.map((p) => p.label)).toEqual(['1-4', '5-8', '9-10']);
  });

  it('every: rejects a nonsense size', () => {
    expectRangeError(() => planSplit('every', { size: 0 }, 10), 'range.badChunkSize');
  });

  it('points: always starts at page 1 even if not given', () => {
    const parts = planSplit('points', { points: [4, 8] }, 10);
    expect(parts.map((p) => p.pages)).toEqual([[1, 2, 3], [4, 5, 6, 7], [8, 9, 10]]);
  });

  it('points: rejects a point outside the document', () => {
    expectRangeError(() => planSplit('points', { points: [99] }, 10), 'range.pointOutside', { page: 99 });
  });

  it('bookmarks: splits at each top-level bookmark', () => {
    const parts = planSplit('bookmarks', {
      bookmarkStarts: [{ title: 'One', page: 1 }, { title: 'Two', page: 5 }],
    }, 8);
    expect(parts.map((p) => p.pages)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
    expect(parts.map((p) => p.label)).toEqual(['One', 'Two']);
  });

  it('bookmarks: content before the first bookmark becomes a leading part', () => {
    const parts = planSplit('bookmarks', {
      bookmarkStarts: [{ title: 'Chapter', page: 3 }],
    }, 6);
    expect(parts.map((p) => p.label)).toEqual(['Start', 'Chapter']);
    expect(parts.map((p) => p.pages)).toEqual([[1, 2], [3, 4, 5, 6]]);
  });

  it('bookmarks: errors when there are none', () => {
    expectRangeError(() => planSplit('bookmarks', { bookmarkStarts: [] }, 10), 'range.noBookmarks');
  });
});
