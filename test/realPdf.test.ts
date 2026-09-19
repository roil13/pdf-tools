/**
 * Bookmark pruning against a REAL document with a genuine, deep outline
 * tree -- the synthetic fixtures cannot model a scanner's or Word's
 * idea of an outline.
 *
 * Skipped automatically when the sample is not present, so the suite
 * still passes on a clean checkout.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { editPages, inspect } from '../electron/operations.js';
import { localSamples } from './samples.js';

const SAMPLE = localSamples()[0] ?? '';
const OUT = path.resolve('test/fixtures/_out');

function outline(file: string) {
  const j = JSON.parse(execFileSync(
    path.resolve('vendor/qpdf/qpdf.exe'),
    ['--json', '--json-key=outlines', file],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  ));
  const flat = (items: any[], depth = 0): any[] =>
    items.flatMap((i) => [{ title: i.title, page: i.destpageposfrom1, depth }, ...flat(i.kids ?? [], depth + 1)]);
  return flat(j.outlines ?? []);
}

const has = fs.existsSync(SAMPLE);

describe.skipIf(!has)('pruning a real-world PDF', () => {
  it('leaves no dead bookmarks behind, and keeps the live ones', async () => {
    const before = await inspect(SAMPLE);
    expect(before.outline.length).toBeGreaterThan(0);

    const half = Math.ceil(before.pageCount / 2);
    const keep = Array.from({ length: half }, (_, i) => i + 1);

    const dst = path.join(OUT, 'real-pruned.pdf');
    const res = await editPages({ input: SAMPLE, output: dst, keep, rotations: [] });

    const after = outline(dst);

    // The point of the change: nothing dead survives.
    expect(after.filter((o) => o.page === null)).toEqual([]);

    // Live bookmarks are not thrown away with them.
    const liveBefore = outline(SAMPLE).filter((o) => o.page !== null && o.page <= half);
    expect(after.length).toBeGreaterThanOrEqual(liveBefore.length);

    // Every surviving entry points inside the new page range.
    for (const o of after) {
      expect(o.page).toBeGreaterThanOrEqual(1);
      expect(o.page).toBeLessThanOrEqual(half);
    }

    // And the accounting the UI shows adds up.
    expect(res.bookmarks!.removed + after.length).toBeGreaterThanOrEqual(before.outline.length);
  });
});
