/**
 * Every operation against real-world PDFs rather than fixtures, checking the
 * outputs are valid and that nothing is stranded in the temp directory.
 * Skipped when the samples are absent, so a clean checkout still passes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspect, editPages, merge, split, compress } from '../electron/operations.js';
import { localSamples } from './samples.js';

const SAMPLES = localSamples();

const OUT = path.resolve('test/fixtures/_out');

/** Read the output back with qpdf, so we are not trusting our own writer. */
function valid(file: string): number {
  const j = JSON.parse(execFileSync(
    path.resolve('vendor/qpdf/qpdf.exe'), ['--json', '--json-key=pages', file],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  ));
  return j.pages.length;
}

// Its own staging directory, so a test file running in parallel cannot be
// mistaken for a leak here.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pdft-real-'));
process.env.PDF_TOOLS_TMPDIR = TMP;

const strays = () => new Set(fs.readdirSync(TMP));

beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

describe.skipIf(SAMPLES.length === 0)('real documents', () => {
  it('inspects every sample without error', async () => {
    for (const f of SAMPLES) {
      const info = await inspect(f);
      expect(info.pageCount).toBeGreaterThan(0);
      expect(info.name).toBeTruthy();
    }
  });

  it('runs every operation and leaves no temp files behind', async () => {
    const before = strays();
    const src = SAMPLES[0];
    const info = await inspect(src);
    const half = Math.max(1, Math.floor(info.pageCount / 2));

    const kept = path.join(OUT, 'rf-kept.pdf');
    await editPages({ input: src, output: kept, keep: [1], rotations: [] });
    expect(valid(kept)).toBe(1);

    const rotated = path.join(OUT, 'rf-rot.pdf');
    await editPages({
      input: src, output: rotated,
      keep: Array.from({ length: half }, (_, i) => i + 1),
      rotations: [{ page: 1, degrees: 90 }],
    });
    expect(valid(rotated)).toBe(half);

    // Reversed, which is where the output-numbered rotate range bites.
    const reversed = path.join(OUT, 'rf-rev.pdf');
    await editPages({
      input: src, output: reversed,
      keep: Array.from({ length: info.pageCount }, (_, i) => info.pageCount - i),
      rotations: [], reordered: true,
    });
    expect(valid(reversed)).toBe(info.pageCount);

    const merged = path.join(OUT, 'rf-merged.pdf');
    await merge({ inputs: [src, kept], output: merged, generateBookmarks: true });
    expect(valid(merged)).toBe(info.pageCount + 1);

    const res = await split({
      input: src, outputDir: OUT,
      parts: [{ pages: [1], fileName: 'rf-split-1.pdf' }],
    });
    expect(valid(res.outputs[0])).toBe(1);

    const squeezed = path.join(OUT, 'rf-small.pdf');
    const c = await compress({ input: src, output: squeezed });
    expect(valid(squeezed)).toBe(info.pageCount);
    expect(c.afterBytes).toBeGreaterThan(0);

    expect([...strays()].filter((f) => !before.has(f))).toEqual([]);
  });
});

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
