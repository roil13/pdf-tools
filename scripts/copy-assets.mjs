/**
 * Stage the runtime assets the renderer fetches at run time into public/.
 *
 * They must be real fetchable files rather than bundled imports because
 * tesseract.js and pdf.js load their workers, WASM cores and data files by URL.
 * Everything is served from the app itself so OCR works with no connection.
 */
import { cp, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PUBLIC = 'public';

async function stage(from, to, filter) {
  const dest = path.join(PUBLIC, to);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  let n = 0;
  for (const e of entries) {
    if (!e.isFile() || (filter && !filter(e.name))) continue;
    await cp(path.join(from, e.name), path.join(dest, e.name));
    n++;
  }
  console.log(`  ${to.padEnd(22)} ${n} files`);
}

console.log('staging renderer assets:');

// pdf.js: character maps and the standard 14 fonts, so non-Latin and
// font-less PDFs render correctly offline.
await stage('node_modules/pdfjs-dist/cmaps', 'cmaps');
await stage('node_modules/pdfjs-dist/standard_fonts', 'standard_fonts');

// tesseract.js worker script.
await mkdir(path.join(PUBLIC, 'tesseract'), { recursive: true });
await cp('node_modules/tesseract.js/dist/worker.min.js', path.join(PUBLIC, 'tesseract/worker.min.js'));
console.log('  tesseract/worker.min.js 1 file');

// tesseract WASM cores. The library feature-detects relaxed-SIMD then SIMD at
// run time and asks for one by name, so all three variants ship. Only the
// "-lstm" ones can ever load, because the worker is created with oem 1
// (LSTM only) -- shipping the other three would add ~24 MB that is never read.
//
// Each variant is a triple, and ALL THREE FILES ARE NEEDED. The ~3.8 MB
// `.wasm.js` is not an asm.js fallback for browsers without WebAssembly, which
// is what its size and name suggest -- it is the Emscripten glue that the
// worker `importScripts()`. Dropping them to save weight on mobile fails with
// "failed to load" the first time OCR runs, which `npm run e2e` catches.
//
// A genuine mobile saving would mean pinning `corePath` at ONE variant and
// shipping only that, which trades ~13 MB against requiring WASM SIMD on the
// device. That is a product decision, not a build tweak, so it is not taken here.
await stage('node_modules/tesseract.js-core', 'tesseract/core',
  (n) => /-lstm\.(js|wasm)$/.test(n) || /-lstm\.wasm\.js$/.test(n));

// Vendored language data and the Hebrew font for the OCR text layer.
await stage('vendor/tessdata', 'tessdata', (n) => n.endsWith('.gz'));
await stage('vendor/fonts', 'fonts', (n) => n.endsWith('.ttf'));

// pdf.js's own text-layer CSS, without which its TextLayer renders a pile of
// unpositioned spans: the rules read per-span custom properties (--font-height,
// --scale-x, --rotate) that TextLayer sets inline and nothing else defines.
//
// Extracted rather than hand-copied so it cannot drift from the installed
// version, and extracted rather than importing pdf_viewer.css wholesale because
// that file is 160 KB and redefines `:root` four times, which would leak
// variables into this app's own design tokens.
await extractRule(
  'node_modules/pdfjs-dist/web/pdf_viewer.css',
  '.textLayer{',
  path.join(PUBLIC, 'pdfjs-textlayer.css'),
);

console.log('done');

/** Copy one top-level CSS rule out of a stylesheet, by balancing braces. */
async function extractRule(from, startsWith, to) {
  const css = await readFile(from, 'utf8');
  const start = css.indexOf(`\n${startsWith}`);
  if (start < 0) throw new Error(`${from}: no rule starting '${startsWith}'`);

  let depth = 0;
  let end = start;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (depth !== 0) throw new Error(`${from}: unbalanced braces after '${startsWith}'`);

  const rule = css.slice(start, end).trim();
  await writeFile(to, `/* Extracted from pdfjs-dist by scripts/copy-assets.mjs. Do not edit. */\n${rule}\n`);
  console.log(`  ${path.basename(to).padEnd(22)} ${rule.length} bytes`);
}
