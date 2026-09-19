/**
 * Integration tests: these drive the REAL bundled qpdf binary against real
 * fixture PDFs. They are what actually prove the structure-preservation claims
 * the whole design rests on -- the pure unit tests cannot.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { inspect, editPages, merge, split, compress } from '../electron/operations.js';

/** Anything left in this file's own staging directory is genuinely a leak. */
const strays = () => new Set(fs.readdirSync(TMP));
const newStrays = (before: Set<string>) => [...strays()].filter((f) => !before.has(f));

const OUT = path.resolve('test/fixtures/_out');
const FIX = (name: string) => path.resolve('test/fixtures', name);
const out = (name: string) => path.join(OUT, name);

/** Read structure back with qpdf directly, so we are not grading our own homework. */
function structure(file: string) {
  const j = JSON.parse(execFileSync(
    path.resolve('vendor/qpdf/qpdf.exe'),
    ['--json', '--json-key=pages', '--json-key=acroform', '--json-key=outlines', file],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  ));
  const flat = (items: any[], depth = 0): any[] =>
    items.flatMap((i) => [{ title: i.title, page: i.destpageposfrom1, depth }, ...flat(i.kids ?? [], depth + 1)]);
  return {
    pages: j.pages.length,
    hasForm: j.acroform.hasacroform as boolean,
    fields: j.acroform.fields.map((f: any) => f.fullname) as string[],
    outline: flat(j.outlines ?? []),
  };
}

/** /Rotate per page, read out of the object graph (a byte grep misses object streams). */
function rotations(file: string): (number | undefined)[] {
  const j = JSON.parse(execFileSync(
    path.resolve('vendor/qpdf/qpdf.exe'), ['--json', file],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  ));
  const objs = j.qpdf[1];
  // qpdf keys objects as "obj:5 0 R", while pages[].object is bare "5 0 R".
  return j.pages.map((p: any) => objs[`obj:${p.object}`]?.value?.['/Rotate']);
}

// Its own staging directory, so a test file running in parallel cannot be
// mistaken for a leak here.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pdft-ops-'));
process.env.PDF_TOOLS_TMPDIR = TMP;

beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(FIX('outlined-form.pdf'))) {
    execFileSync('node', ['scripts/make-fixtures.mjs'], { stdio: 'inherit' });
  }
});

describe('inspect', () => {
  it('reports pages, bookmarks and form fields', async () => {
    const info = await inspect(FIX('outlined-form.pdf'));
    expect(info.pageCount).toBe(10);
    expect(info.hasAcroForm).toBe(true);
    expect(info.hasOutlines).toBe(true);
    expect(info.isEncrypted).toBe(false);
    expect(info.outline.map((o) => o.title)).toContain('Chapter Two');
  });

  it('resolves a page number for each bookmark, and nests them', async () => {
    const info = await inspect(FIX('outlined-form.pdf'));
    const ch1 = info.outline.find((o) => o.title === 'Chapter One');
    const s11 = info.outline.find((o) => o.title === 'Section 1.1');
    expect(ch1).toMatchObject({ page: 1, depth: 0 });
    expect(s11).toMatchObject({ page: 2, depth: 1 });
  });

  it('reports a plain PDF as having neither', async () => {
    const info = await inspect(FIX('plain.pdf'));
    expect(info.hasOutlines).toBe(false);
    expect(info.hasAcroForm).toBe(false);
    expect(info.outline).toEqual([]);
  });
});

describe('editPages', () => {
  it('extracts pages while preserving form fields and live bookmarks', async () => {
    const dst = out('t-extract.pdf');
    await editPages({ input: FIX('outlined-form.pdf'), output: dst, keep: [1, 2, 3, 7], rotations: [] });

    const s = structure(dst);
    expect(s.pages).toBe(4);
    expect(s.hasForm).toBe(true);
    expect(s.fields).toEqual(['spike.name']);
    // Bookmarks whose pages were kept come across intact.
    expect(s.outline.map((o) => o.title)).toContain('Chapter One');
    expect(s.outline.map((o) => o.title)).toContain('Section 1.1');
  });

  it('prunes bookmarks whose target page was removed', async () => {
    // Superseded behaviour: these used to survive as dead entries.
    // See test/pruneOutline.test.ts for the full pruning rules.
    const dst = out('t-dead.pdf');
    await editPages({ input: FIX('outlined-form.pdf'), output: dst, keep: [1, 2, 3], rotations: [] });

    const s = structure(dst);
    expect(s.outline.find((o) => o.title === 'Chapter One')?.page).toBe(1);
    // Chapter Two pointed at page 6, which is gone -- so it is gone too.
    expect(s.outline.find((o) => o.title === 'Chapter Two')).toBeUndefined();
    // And nothing left in the outline is dead.
    expect(s.outline.every((o) => o.page !== null)).toBe(true);
  });

  it('deletes pages via the complement', async () => {
    const dst = out('t-delete.pdf');
    // remove pages 2 and 4 of 10
    const keep = [1, 3, 5, 6, 7, 8, 9, 10];
    await editPages({ input: FIX('plain.pdf'), output: dst, keep, rotations: [] });
    expect(structure(dst).pages).toBe(8);
  });

  it('rotates the correct page when the selection is NOT the identity', async () => {
    // The regression this guards: qpdf's --rotate ranges are OUTPUT-numbered.
    // Keep source pages 6-10 and rotate source page 6 -> output page 1.
    const dst = out('t-rotate.pdf');
    await editPages({
      input: FIX('plain.pdf'), output: dst,
      keep: [6, 7, 8, 9, 10],
      rotations: [{ page: 6, degrees: 90 }],
    });
    expect(rotations(dst)).toEqual([90, undefined, undefined, undefined, undefined]);
  });

  it('rotates a middle page correctly under a shifted selection', async () => {
    const dst = out('t-rotate2.pdf');
    await editPages({
      input: FIX('plain.pdf'), output: dst,
      keep: [6, 7, 8, 9, 10],
      rotations: [{ page: 8, degrees: 180 }],
    });
    expect(rotations(dst)).toEqual([undefined, undefined, 180, undefined, undefined]);
  });

  it('ignores a rotation on a page that is being removed', async () => {
    const dst = out('t-rotate3.pdf');
    await editPages({
      input: FIX('plain.pdf'), output: dst,
      keep: [1, 2], rotations: [{ page: 9, degrees: 90 }],
    });
    expect(rotations(dst)).toEqual([undefined, undefined]);
  });

  it('refuses an empty selection', async () => {
    // Errors carry a translation key, not prose: the main process has no idea
    // what language the interface is in.
    await expect(editPages({
      input: FIX('plain.pdf'), output: out('t-nope.pdf'), keep: [], rotations: [],
    })).rejects.toThrow('error.selectAtLeastOnePage');
  });
});

describe('merge', () => {
  it('keeps the first file structure and adds a bookmark per appended file', async () => {
    const dst = out('t-merge-splice.pdf');
    await merge({
      inputs: [FIX('outlined-form.pdf'), FIX('beta.pdf'), FIX('gamma.pdf')],
      output: dst,
      generateBookmarks: true,
    });

    const s = structure(dst);
    expect(s.pages).toBe(15);
    expect(s.hasForm).toBe(true);

    const top = s.outline.filter((o) => o.depth === 0).map((o) => o.title);
    expect(top).toEqual(['Chapter One', 'Chapter Two', 'פרק שלוש', 'beta', 'gamma']);
    // beta starts after outlined-form's 10 pages; gamma after beta's 3.
    expect(s.outline.find((o) => o.title === 'beta')?.page).toBe(11);
    expect(s.outline.find((o) => o.title === 'gamma')?.page).toBe(14);
  });

  it('creates an outline root when the first file has none (the common case)', async () => {
    const dst = out('t-merge-create.pdf');
    await merge({
      inputs: [FIX('plain.pdf'), FIX('beta.pdf'), FIX('gamma.pdf')],
      output: dst,
      generateBookmarks: true,
    });

    const s = structure(dst);
    expect(s.pages).toBe(15);
    expect(s.outline.map((o) => o.title)).toEqual(['beta', 'gamma']);
    expect(s.outline.map((o) => o.page)).toEqual([11, 14]);
  });

  it('can merge without generating bookmarks', async () => {
    const dst = out('t-merge-plain.pdf');
    await merge({
      inputs: [FIX('plain.pdf'), FIX('beta.pdf')],
      output: dst,
      generateBookmarks: false,
    });
    const s = structure(dst);
    expect(s.pages).toBe(13);
    expect(s.outline).toEqual([]);
  });

  it('refuses a single input', async () => {
    await expect(merge({
      inputs: [FIX('plain.pdf')], output: out('t-nope.pdf'), generateBookmarks: true,
    })).rejects.toThrow('error.needTwoPdfs');
  });
});

describe('split', () => {
  it('writes one file per part, each keeping document structure', async () => {
    const res = await split({
      input: FIX('outlined-form.pdf'),
      outputDir: OUT,
      parts: [
        { pages: [1, 2, 3], fileName: 't-split-a.pdf' },
        { pages: [4, 5, 6], fileName: 't-split-b.pdf' },
        { pages: [7, 8, 9, 10], fileName: 't-split-c.pdf' },
      ],
    });

    expect(res.outputs).toHaveLength(3);
    expect(structure(res.outputs[0]).pages).toBe(3);
    expect(structure(res.outputs[1]).pages).toBe(3);
    expect(structure(res.outputs[2]).pages).toBe(4);
    // Structure survives per part -- qpdf's own --split-pages would drop it.
    expect(structure(res.outputs[0]).hasForm).toBe(true);
  });

  it('names files from bookmark titles, sanitised and de-duplicated', async () => {
    // The riskiest path in the app: it writes several files whose names come
    // from untrusted document text.
    const { planSplit } = await import('../src/lib/pageRanges.js');
    const { safeName, uniquify } = await import('../src/lib/safeName.js');

    const info = await inspect(FIX('outlined-form.pdf'));
    const tops = info.outline
      .filter((o) => o.depth === 0 && o.page !== null)
      .map((o) => ({ title: o.title, page: o.page as number }));

    const raw = planSplit('bookmarks', { bookmarkStarts: tops }, info.pageCount);
    const names = uniquify(raw.map((p, i) => safeName(p.label, `part ${i + 1}`)));

    const dir = path.join(OUT, 'bm');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const res = await split({
      input: FIX('outlined-form.pdf'),
      outputDir: dir,
      parts: raw.map((p, i) => ({ pages: p.pages, fileName: `${names[i]}.pdf` })),
    });

    const written = fs.readdirSync(dir).sort();
    expect(written).toEqual([
      'Chapter One.pdf', 'Chapter Two.pdf', 'פרק שלוש.pdf',
    ].sort());
    // Every written file must be a real, readable PDF.
    for (const f of res.outputs) expect(structure(f).pages).toBeGreaterThan(0);
    // The parts must together cover every page exactly once.
    const total = res.outputs.reduce((n, f) => n + structure(f).pages, 0);
    expect(total).toBe(info.pageCount);
  });
});

describe('failure leaves nothing behind', () => {
  it('merge removes its staged file when qpdf fails', async () => {
    // Regression: runQpdf used to sit outside the try, so a failure skipped the
    // cleanup and stranded a temp file.
    const before = strays();
    await expect(merge({
      inputs: [FIX('outlined-form.pdf'), out('not-a.pdf')],
      output: out('t-merge-fail.pdf'),
      generateBookmarks: true,
    })).rejects.toThrow();
    expect(newStrays(before)).toEqual([]);
  });

  it('compress leaves the destination untouched when qpdf fails', async () => {
    // Regression: compress used to write straight to the user's chosen path,
    // so a failure could truncate a file they already had.
    const dst = out('t-precious.pdf');
    fs.copyFileSync(FIX('plain.pdf'), dst);
    const original = fs.readFileSync(dst);

    const before = strays();
    await expect(compress({ input: out('not-a.pdf'), output: dst })).rejects.toThrow();

    expect(fs.readFileSync(dst).equals(original)).toBe(true);
    expect(newStrays(before)).toEqual([]);
  });

  it('split removes its staged file when a part fails', async () => {
    const before = strays();
    await expect(split({
      input: out('not-a.pdf'),
      outputDir: OUT,
      parts: [{ pages: [1], fileName: 't-split-fail.pdf' }],
    })).rejects.toThrow();
    expect(newStrays(before)).toEqual([]);
  });
});

describe('compress', () => {
  it('produces a valid, readable PDF and reports both sizes', async () => {
    const dst = out('t-compressed.pdf');
    const res = await compress({ input: FIX('outlined-form.pdf'), output: dst });

    expect(res.beforeBytes).toBeGreaterThan(0);
    expect(res.afterBytes).toBeGreaterThan(0);
    // The point is validity, not a guaranteed size win on a tiny synthetic file.
    expect(structure(dst).pages).toBe(10);
    expect(structure(dst).hasForm).toBe(true);
  });
});

describe('error handling', () => {
  it('gives a readable message for a file that is not a PDF', async () => {
    const notPdf = out('not-a.pdf');
    fs.writeFileSync(notPdf, 'hello, this is not a PDF at all');
    await expect(inspect(notPdf)).rejects.toThrow();
  });

  it('gives a readable message for a missing file', async () => {
    await expect(inspect(out('does-not-exist.pdf'))).rejects.toThrow();
  });
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
