/**
 * Page-range helpers. Everything here is 1-INDEXED, matching both the UI and
 * qpdf's --pages syntax. pdf-lib and pdf.js are 0-indexed; convert only at
 * those boundaries, and name variables `pageNum` (1-based) vs `pageIndex` (0-based).
 */
import { RangeParseError } from './errors.js';

/**
 * Parse "1-3, 5, 8-10" into [1,2,3,5,8,9,10].
 * Duplicates are collapsed; the result is sorted ascending.
 */
export function parseRanges(input: string, pageCount: number): number[] {
  const text = input.trim();
  if (!text) return [];

  const pages = new Set<number>();
  for (const rawPart of text.split(/[,;]/)) {
    const part = rawPart.trim();
    if (!part) continue;

    const m = /^(\d+)\s*(?:-|–|—|\.\.)\s*(\d+)$/.exec(part);
    if (m) {
      const from = Number(m[1]);
      const to = Number(m[2]);
      assertInRange(from, pageCount);
      assertInRange(to, pageCount);
      if (from > to) throw new RangeParseError('range.backwards', { part, from: to, to: from });
      for (let p = from; p <= to; p++) pages.add(p);
      continue;
    }

    if (/^\d+$/.test(part)) {
      const p = Number(part);
      assertInRange(p, pageCount);
      pages.add(p);
      continue;
    }

    throw new RangeParseError('range.notARange', { part });
  }
  return [...pages].sort((a, b) => a - b);
}

function assertInRange(page: number, pageCount: number): void {
  if (page < 1) throw new RangeParseError('range.startsAtOne');
  if (page > pageCount) {
    throw new RangeParseError('range.outOfRange', { n: pageCount, page });
  }
}

/**
 * Inverse of parseRanges: [1,2,3,5] -> "1-3,5".
 * Preserves the given order, so a deliberately reordered selection survives
 * (qpdf honours "3,1,2" as an output ordering).
 */
export function formatRanges(pages: number[]): string {
  if (pages.length === 0) return '';
  const parts: string[] = [];
  let start = pages[0];
  let prev = pages[0];

  for (let i = 1; i <= pages.length; i++) {
    const cur = pages[i];
    if (cur === prev + 1) { prev = cur; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return parts.join(',');
}

/** Pages of a document that are NOT in `pages`. Powers "remove selected". */
export function complement(pages: number[], pageCount: number): number[] {
  const drop = new Set(pages);
  const out: number[] = [];
  for (let p = 1; p <= pageCount; p++) if (!drop.has(p)) out.push(p);
  return out;
}

export type SplitMode = 'points' | 'every' | 'each' | 'bookmarks';

export interface SplitOptions {
  /** 'points': 1-indexed pages that each START a new part. */
  points?: number[];
  /** 'every': part size in pages. */
  size?: number;
  /** 'bookmarks': 1-indexed start page of each top-level bookmark. */
  bookmarkStarts?: { title: string; page: number }[];
}

export interface SplitPartPlan {
  pages: number[];
  /** Suggested label; the caller turns this into a filename. */
  label: string;
}

/** Turn a split mode into concrete page groups. */
export function planSplit(mode: SplitMode, opts: SplitOptions, pageCount: number): SplitPartPlan[] {
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  switch (mode) {
    case 'each':
      return range(1, pageCount).map((p) => ({ pages: [p], label: `${p}` }));

    case 'every': {
      const size = opts.size ?? 0;
      if (!Number.isInteger(size) || size < 1) throw new RangeParseError('range.badChunkSize');
      const parts: SplitPartPlan[] = [];
      for (let from = 1; from <= pageCount; from += size) {
        const to = Math.min(from + size - 1, pageCount);
        parts.push({ pages: range(from, to), label: from === to ? `${from}` : `${from}-${to}` });
      }
      return parts;
    }

    case 'points': {
      const starts = normaliseStarts(opts.points ?? [], pageCount);
      return startsToParts(starts.map((page) => ({ page })), pageCount, range);
    }

    case 'bookmarks': {
      const marks = (opts.bookmarkStarts ?? []).filter((b) => b.page >= 1 && b.page <= pageCount);
      if (!marks.length) throw new RangeParseError('range.noBookmarks');
      const sorted = [...marks].sort((a, b) => a.page - b.page);
      // Content before the first bookmark becomes its own leading part.
      const withLead = sorted[0].page > 1
        ? [{ page: 1, title: 'Start' }, ...sorted]
        : sorted;
      return startsToParts(withLead, pageCount, range);
    }
  }
}

function normaliseStarts(points: number[], pageCount: number): number[] {
  const set = new Set<number>([1]);
  for (const p of points) {
    if (p < 1 || p > pageCount) throw new RangeParseError('range.pointOutside', { page: p });
    set.add(p);
  }
  return [...set].sort((a, b) => a - b);
}

function startsToParts(
  starts: { page: number; title?: string }[],
  pageCount: number,
  range: (a: number, b: number) => number[],
): SplitPartPlan[] {
  const uniq: { page: number; title?: string }[] = [];
  for (const s of starts) {
    if (!uniq.length || uniq[uniq.length - 1].page !== s.page) uniq.push(s);
  }
  return uniq.map((s, i) => {
    const to = i + 1 < uniq.length ? uniq[i + 1].page - 1 : pageCount;
    return {
      pages: range(s.page, to),
      label: s.title ?? (s.page === to ? `${s.page}` : `${s.page}-${to}`),
    };
  }).filter((p) => p.pages.length > 0);
}
