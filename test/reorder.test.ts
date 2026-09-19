/**
 * Page reordering, and what it does to bookmarks.
 *
 * Two separate things are being checked: that destinations FOLLOW their pages
 * (which PDF gives us for free, since destinations reference page objects, not
 * indices), and that the outline is re-sorted to match the new page order only
 * when the user actually rearranged something.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { editPages } from '../electron/operations.js';

const OUT = path.resolve('test/fixtures/_out');
const FIX = (n: string) => path.resolve('test/fixtures', n);
const out = (n: string) => path.join(OUT, n);

/** Outline in TREE order, which is the order a viewer's panel shows. */
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

/** Read the visible label off each page, to prove pages really moved. */
async function pageLabels(file: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  }).promise;
  const labels: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    labels.push((tc.items as { str: string }[]).map((x) => x.str).join('').trim());
  }
  await doc.loadingTask?.destroy?.();
  return labels;
}

beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(FIX('outlined-form.pdf'))) {
    execFileSync('node', ['scripts/make-fixtures.mjs'], { stdio: 'inherit' });
  }
});

describe('reordering pages', () => {
  it('actually moves the pages', async () => {
    const dst = out('r-move.pdf');
    // Put page 8 first, then 1-7, then 9-10.
    await editPages({
      input: FIX('outlined-form.pdf'), output: dst,
      keep: [8, 1, 2, 3, 4, 5, 6, 7, 9, 10], rotations: [], reordered: true,
    });

    const labels = await pageLabels(dst);
    expect(labels[0]).toContain('page 8');
    expect(labels[1]).toContain('page 1');
    expect(labels[9]).toContain('page 10');
  });

  it('carries bookmark destinations along with their pages', async () => {
    const dst = out('r-dest.pdf');
    await editPages({
      input: FIX('outlined-form.pdf'), output: dst,
      keep: [8, 1, 2, 3, 4, 5, 6, 7, 9, 10], rotations: [], reordered: true,
    });

    const o = outline(dst);
    // Was p8, now the first page.
    expect(o.find((x) => x.title === 'פרק שלוש')?.page).toBe(1);
    // Everything else shifted down by one.
    expect(o.find((x) => x.title === 'Chapter One')?.page).toBe(2);
    expect(o.find((x) => x.title === 'Chapter Two')?.page).toBe(7);
  });

  it('re-sorts the bookmark list to match the new page order', async () => {
    const dst = out('r-sort.pdf');
    await editPages({
      input: FIX('outlined-form.pdf'), output: dst,
      keep: [8, 1, 2, 3, 4, 5, 6, 7, 9, 10], rotations: [], reordered: true,
    });

    // The Hebrew chapter is now on page 1, so it must be listed first --
    // a viewer shows bookmarks in tree order, not by destination.
    const top = outline(dst).filter((x) => x.depth === 0).map((x) => x.title);
    expect(top).toEqual(['פרק שלוש', 'Chapter One', 'Chapter Two']);

    // Top-level entries are in ascending page order.
    const pages = outline(dst).filter((x) => x.depth === 0).map((x) => x.page);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
  });

  it('keeps nesting intact when re-sorting', async () => {
    const dst = out('r-nest.pdf');
    await editPages({
      input: FIX('outlined-form.pdf'), output: dst,
      keep: [8, 1, 2, 3, 4, 5, 6, 7, 9, 10], rotations: [], reordered: true,
    });

    const o = outline(dst);
    // Sections stay under their chapter rather than being promoted.
    const idx = o.findIndex((x) => x.title === 'Chapter One');
    expect(o[idx + 1]).toMatchObject({ title: 'Section 1.1', depth: 1 });
    expect(o[idx + 2]?.depth).toBe(1);
  });

  it('leaves the bookmark order alone when nothing was rearranged', async () => {
    // Same pages, natural order, reordered not set: the outline must be
    // untouched, since it may never have been in page order to begin with.
    const dst = out('r-noop.pdf');
    await editPages({
      input: FIX('outlined-form.pdf'), output: dst,
      keep: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rotations: [],
    });

    const top = outline(dst).filter((x) => x.depth === 0).map((x) => x.title);
    expect(top).toEqual(['Chapter One', 'Chapter Two', 'פרק שלוש']);
  });

  it('reverses a document end to end', async () => {
    const dst = out('r-reverse.pdf');
    const keep = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    await editPages({
      input: FIX('outlined-form.pdf'), output: dst, keep, rotations: [], reordered: true,
    });

    const labels = await pageLabels(dst);
    expect(labels[0]).toContain('page 10');
    expect(labels[9]).toContain('page 1');

    // Bookmarks follow, and are listed in the new page order.
    const top = outline(dst).filter((x) => x.depth === 0);
    expect(top.map((x) => x.page)).toEqual([...top.map((x) => x.page)].sort((a, b) => a - b));
    expect(top[0].title).toBe('פרק שלוש'); // was p8, now p3
  });

  it('combines reordering with removing pages and rotation', async () => {
    const dst = out('r-combo.pdf');
    // Keep 6,1,2 in that order; rotate source page 1 (output position 2).
    await editPages({
      input: FIX('outlined-form.pdf'), output: dst,
      keep: [6, 1, 2], rotations: [{ page: 1, degrees: 90 }], reordered: true,
    });

    const labels = await pageLabels(dst);
    expect(labels[0]).toContain('page 6');
    expect(labels[1]).toContain('page 1');

    const j = JSON.parse(execFileSync(
      path.resolve('vendor/qpdf/qpdf.exe'), ['--json', dst],
      { encoding: 'utf8', maxBuffer: 1 << 28 },
    ));
    const objs = j.qpdf[1];
    const rot = j.pages.map((p: any) => objs[`obj:${p.object}`]?.value?.['/Rotate']);
    expect(rot).toEqual([undefined, 90, undefined]);

    // No dead bookmarks, and the surviving ones are in page order.
    const o = outline(dst);
    expect(o.every((x) => x.page !== null)).toBe(true);
    const top = o.filter((x) => x.depth === 0).map((x) => x.page);
    expect(top).toEqual([...top].sort((a, b) => a - b));
  });
});
