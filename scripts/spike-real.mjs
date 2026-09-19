// Q7 (hard case): pdf-lib must round-trip qpdf's OWN output (object streams,
// compressed xref) without damage -- that is exactly the Step 6 merge pipeline.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';

const QPDF = 'vendor/qpdf/qpdf.exe';
const inspect = (p) => {
  const j = JSON.parse(execFileSync(QPDF,
    ['--json', '--json-key=outlines', '--json-key=acroform', '--json-key=pages', '--json-key=encrypt', p],
    { encoding: 'utf8', maxBuffer: 1 << 28 }));
  const flat = (items) => items.flatMap(i => [i, ...flat(i.kids || [])]);
  return {
    pages: j.pages.length,
    form: j.acroform.hasacroform,
    fields: j.acroform.fields.length,
    outlines: flat(j.outlines).length,
    dead: flat(j.outlines).filter(o => o.destpageposfrom1 === null).length,
    encrypted: j.encrypt.encrypted,
  };
};

for (const src of process.argv.slice(2)) {
  const label = src.split(/[\/]/).pop();
  try {
    const before = inspect(src);
    if (before.encrypted) { console.log(`\n${label}\n  SKIPPED (encrypted)`); continue; }

    // stage 1: qpdf page selection (keep roughly the first half)
    const keep = `1-${Math.max(1, Math.ceil(before.pages / 2))}`;
    const staged = 'test/fixtures/_out/_stage.pdf';
    execFileSync(QPDF, [src, '--pages', '.', keep, '--', staged]);
    const mid = inspect(staged);

    // stage 2: pdf-lib load + untouched re-save of qpdf's output
    const doc = await PDFDocument.load(readFileSync(staged), { ignoreEncryption: true });
    const out = 'test/fixtures/_out/_stage.rt.pdf';
    writeFileSync(out, await doc.save({ updateFieldAppearances: false }));
    const after = inspect(out);

    const ok = mid.pages === after.pages && mid.form === after.form
            && mid.fields === after.fields && mid.outlines === after.outlines;
    console.log(`\n${label}`);
    console.log(`  source : ${before.pages}p form=${before.form}(${before.fields}) outlines=${before.outlines}`);
    console.log(`  qpdf   : ${mid.pages}p form=${mid.form}(${mid.fields}) outlines=${mid.outlines} dead=${mid.dead}`);
    console.log(`  pdf-lib: ${after.pages}p form=${after.form}(${after.fields}) outlines=${after.outlines} dead=${after.dead}`);
    console.log(`  ROUND-TRIP: ${ok ? 'OK' : '*** MISMATCH ***'}`);
  } catch (e) {
    console.log(`\n${label}\n  ERROR: ${String(e.message).split('\n')[0]}`);
  }
}
