/**
 * Bookmark pruning. The interesting case is a bookmark that is itself dead
 * while its children survive -- deleting it would orphan sections that are
 * still in the document.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { editPages, split, inspect } from '../electron/operations.js';

const OUT = path.resolve('test/fixtures/_out');
const FIX = (n: string) => path.resolve('test/fixtures', n);
const out = (n: string) => path.join(OUT, n);

/** Read the outline back with qpdf, independently of what we wrote. */
function outline(file: string) {
  const j = JSON.parse(execFileSync(
    path.resolve('vendor/qpdf/qpdf.exe'),
    ['--json', '--json-key=outlines', file],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  ));
  const flat = (items: any[], depth = 0): any[] =>
    items.flatMap((i) => [
      { title: i.title, page: i.destpageposfrom1, depth },
      ...flat(i.kids ?? [], depth + 1),
    ]);
  return flat(j.outlines ?? []);
}

beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(FIX('outlined-form.pdf'))) {
    execFileSync('node', ['scripts/make-fixtures.mjs'], { stdio: 'inherit' });
  }
});

describe('bookmark pruning on editPages', () => {
  it('drops bookmarks whose page was removed', async () => {
    // Keep 1-3. "Chapter Two" (p6) and "פרק שלוש" (p8) are gone.
    const dst = out('p-drop.pdf');
    const res = await editPages({
      input: FIX('outlined-form.pdf'), output: dst, keep: [1, 2, 3], rotations: [],
    });

    const o = outline(dst);
    expect(o.map((x) => x.title)).toEqual(['Chapter One', 'Section 1.1']);
    // Nothing dead is left behind.
    expect(o.every((x) => x.page !== null)).toBe(true);
    expect(res.bookmarks?.removed).toBe(3);
  });

  it('keeps a dead parent that still has surviving children, retargeted', async () => {
    // Keep pages 2 and 8. "Chapter One" (p1) is dead but "Section 1.1" (p2)
    // survives underneath it -- deleting the parent would orphan the section.
    const dst = out('p-orphan.pdf');
    const res = await editPages({
      input: FIX('outlined-form.pdf'), output: dst, keep: [2, 8], rotations: [],
    });

    const o = outline(dst);
    expect(o.map((x) => `${'  '.repeat(x.depth)}${x.title}`)).toEqual([
      'Chapter One',
      '  Section 1.1',
      'פרק שלוש',
    ]);
    // The kept parent now points at its first surviving child's page.
    expect(o.find((x) => x.title === 'Chapter One')?.page).toBe(1);
    expect(o.find((x) => x.title === 'Section 1.1')?.page).toBe(1);
    expect(o.find((x) => x.title === 'פרק שלוש')?.page).toBe(2);
    expect(res.bookmarks).toEqual({ removed: 2, retargeted: 1 });
  });

  it('leaves a fully intact outline alone', async () => {
    const dst = out('p-intact.pdf');
    const res = await editPages({
      input: FIX('outlined-form.pdf'), output: dst,
      keep: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rotations: [],
    });
    expect(outline(dst).length).toBe(5);
    expect(res.bookmarks).toEqual({ removed: 0, retargeted: 0 });
  });

  it('removes the outline entirely when nothing survives', async () => {
    // Keep only pages 3-4: no bookmark targets either.
    const dst = out('p-none.pdf');
    await editPages({
      input: FIX('outlined-form.pdf'), output: dst, keep: [3, 4], rotations: [],
    });
    expect(outline(dst)).toEqual([]);
    expect((await inspect(dst)).hasOutlines).toBe(false);
  });

  it('does not disturb form fields or pages', async () => {
    const dst = out('p-form.pdf');
    await editPages({
      input: FIX('outlined-form.pdf'), output: dst, keep: [1, 2], rotations: [],
    });
    const info = await inspect(dst);
    expect(info.pageCount).toBe(2);
    expect(info.hasAcroForm).toBe(true);
  });
});

describe('bookmark pruning on split', () => {
  it('gives each piece only the bookmarks that land inside it', async () => {
    const res = await split({
      input: FIX('outlined-form.pdf'),
      outputDir: OUT,
      parts: [
        { pages: [1, 2, 3, 4, 5], fileName: 'p-split-a.pdf' },
        { pages: [6, 7, 8, 9, 10], fileName: 'p-split-b.pdf' },
      ],
    });

    const a = outline(res.outputs[0]).map((x) => x.title);
    const b = outline(res.outputs[1]).map((x) => x.title);

    // Part A holds Chapter One and both its sections; part B the rest.
    expect(a).toEqual(['Chapter One', 'Section 1.1', 'Section 1.2 (page 5, will be dropped)']);
    expect(b).toEqual(['Chapter Two', 'פרק שלוש']);

    // And every entry in both parts actually resolves.
    for (const f of res.outputs) {
      expect(outline(f).every((x) => x.page !== null)).toBe(true);
    }
  });
});
