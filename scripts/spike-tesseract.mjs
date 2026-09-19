/**
 * OCR spike 2: what does tesseract.js 7 actually return?
 *
 * The text-layer placement needs per-WORD bounding boxes. Across major versions
 * tesseract.js has moved word data between `data.words` and a nested
 * `data.blocks[].paragraphs[].lines[].words[]`, and in some versions word output
 * is off unless explicitly requested. Settle it empirically before designing.
 */
import { createWorker } from 'tesseract.js';
import path from 'node:path';

const LANG_PATH = path.resolve('vendor/tessdata');

const worker = await createWorker(['eng', 'heb'], 1, {
  langPath: LANG_PATH,
  gzip: true,
  // No logger: we only want the result shape.
});

const { data } = await worker.recognize(
  path.resolve('test/fixtures/ocr-sample.png'),
  {},
  { blocks: true, text: true },
);

console.log('top-level keys :', Object.keys(data));
console.log('has data.words :', Array.isArray(data.words), data.words?.length ?? 0);
console.log('has data.blocks:', Array.isArray(data.blocks), data.blocks?.length ?? 0);
console.log('\n--- text ---\n' + (data.text ?? '').trim());

function collectWords(d) {
  if (Array.isArray(d.words) && d.words.length) return d.words;
  const out = [];
  for (const b of d.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) out.push(w);
      }
    }
  }
  return out;
}

const words = collectWords(data);
console.log(`\n--- ${words.length} words found ---`);
for (const w of words.slice(0, 6)) {
  console.log(`  ${JSON.stringify(w.text)}  conf=${w.confidence?.toFixed?.(1)}  bbox=${JSON.stringify(w.bbox)}`);
}
if (words[0]) console.log('\nword object keys:', Object.keys(words[0]).join(', '));

await worker.terminate();
