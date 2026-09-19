/**
 * The invisible text layer is the one feature whose failure is undetectable by
 * looking at the output: a broken font or bad geometry produces a PDF that
 * renders perfectly and simply never matches a search. These tests read the
 * text back out with pdf.js and check both the characters and where they landed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { addTextLayer, type PageWords } from '../src/lib/textLayer.js';
import type { OcrWord } from '../src/lib/ocr.js';

const OUT = path.resolve('test/fixtures/_out');
const FIX = (n: string) => path.resolve('test/fixtures', n);
const FONT = path.resolve('vendor/fonts/NotoSansHebrew-Regular.ttf');

const DPI = 300;
const SCALE = DPI / 72;
const PAGE_H = 792; // the fixtures are US Letter

/** Mimics pdf.js's viewport mapping for an unrotated page. */
const toPdfPoint = (x: number, y: number): [number, number] => [x / SCALE, PAGE_H - y / SCALE];

function word(text: string, x0: number, y0: number, w: number, h = 40): OcrWord {
  return { text, confidence: 95, x0, y0, x1: x0 + w, y1: y0 + h };
}

/** Read text items back, with their positions, exactly as a PDF viewer would. */
async function extract(file: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = content.items
    .filter((i: any) => i.str?.trim())
    .map((i: any) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
  await doc.loadingTask?.destroy?.();
  return items;
}

beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(FIX('blank.pdf'))) {
    execFileSync('node', ['scripts/make-fixtures.mjs'], { stdio: 'inherit' });
  }
});

describe('addTextLayer', () => {
  it('makes English words searchable', async () => {
    const words = [word('Hello', 300, 300, 200), word('invoice', 550, 300, 260)];
    const pages: PageWords[] = [{ pageNum: 1, words, toPdfPoint, scale: SCALE, rotation: 0 }];

    const dst = path.join(OUT, 'tl-english.pdf');
    fs.writeFileSync(dst, await addTextLayer(fs.readFileSync(FIX('blank.pdf')), pages, null));

    const items = await extract(dst);
    expect(items.map((i) => i.str)).toEqual(['Hello', 'invoice']);
  });

  it('makes Hebrew words searchable, which needs the embedded font', async () => {
    const words = [word('שלום', 300, 300, 160), word('חשבונית', 500, 300, 240)];
    const pages: PageWords[] = [{ pageNum: 1, words, toPdfPoint, scale: SCALE, rotation: 0 }];

    const dst = path.join(OUT, 'tl-hebrew.pdf');
    fs.writeFileSync(dst, await addTextLayer(
      fs.readFileSync(FIX('blank.pdf')), pages, new Uint8Array(fs.readFileSync(FONT)),
    ));

    const items = await extract(dst);
    expect(items.map((i) => i.str)).toEqual(['שלום', 'חשבונית']);
  });

  it('mixes scripts on one page', async () => {
    const words = [word('Total', 200, 200, 180), word('סך', 450, 200, 90)];
    const pages: PageWords[] = [{ pageNum: 1, words, toPdfPoint, scale: SCALE, rotation: 0 }];

    const dst = path.join(OUT, 'tl-mixed.pdf');
    fs.writeFileSync(dst, await addTextLayer(
      fs.readFileSync(FIX('blank.pdf')), pages, new Uint8Array(fs.readFileSync(FONT)),
    ));

    expect((await extract(dst)).map((i) => i.str)).toEqual(['Total', 'סך']);
  });

  it('places each word where its box was, so highlights line up', async () => {
    // Box at image (300, 300)-(500, 340) at 300dpi maps to PDF (72, 792-113.3).
    const words = [word('anchor', 300, 300, 200)];
    const pages: PageWords[] = [{ pageNum: 1, words, toPdfPoint, scale: SCALE, rotation: 0 }];

    const dst = path.join(OUT, 'tl-pos.pdf');
    fs.writeFileSync(dst, await addTextLayer(fs.readFileSync(FIX('blank.pdf')), pages, null));

    const [item] = await extract(dst);
    const [wantX, wantY] = toPdfPoint(300, 340);
    expect(item.x).toBeCloseTo(wantX, 1);
    expect(item.y).toBeCloseTo(wantY, 1);
  });

  it('drops low-confidence words rather than inserting wrong text', async () => {
    const words: OcrWord[] = [
      { ...word('solid', 300, 300, 160), confidence: 92 },
      { ...word('gibberish', 300, 400, 160), confidence: 12 },
    ];
    const pages: PageWords[] = [{ pageNum: 1, words, toPdfPoint, scale: SCALE, rotation: 0 }];

    const dst = path.join(OUT, 'tl-conf.pdf');
    fs.writeFileSync(dst, await addTextLayer(fs.readFileSync(FIX('blank.pdf')), pages, null));

    expect((await extract(dst)).map((i) => i.str)).toEqual(['solid']);
  });

  it('leaves the rest of the document alone', async () => {
    const words = [word('added', 300, 300, 160)];
    const pages: PageWords[] = [{ pageNum: 2, words, toPdfPoint, scale: SCALE, rotation: 0 }];

    const dst = path.join(OUT, 'tl-intact.pdf');
    fs.writeFileSync(dst, await addTextLayer(
      fs.readFileSync(FIX('outlined-form.pdf')), pages, null,
    ));

    // Bookmarks and form fields must survive the round-trip.
    const j = JSON.parse(execFileSync(
      path.resolve('vendor/qpdf/qpdf.exe'),
      ['--json', '--json-key=pages', '--json-key=acroform', '--json-key=outlines', dst],
      { encoding: 'utf8', maxBuffer: 1 << 28 },
    ));
    expect(j.pages.length).toBe(10);
    expect(j.acroform.hasacroform).toBe(true);
    expect(j.outlines.length).toBe(3);
  });

  it('handles a page with no recognised words', async () => {
    const pages: PageWords[] = [{ pageNum: 1, words: [], toPdfPoint, scale: SCALE, rotation: 0 }];
    const dst = path.join(OUT, 'tl-empty.pdf');
    fs.writeFileSync(dst, await addTextLayer(fs.readFileSync(FIX('blank.pdf')), pages, null));
    expect((await extract(dst)).length).toBe(0);
  });
});
