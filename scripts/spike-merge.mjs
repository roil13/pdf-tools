// End-to-end check of the two-phase merge, exercising BOTH outline paths.
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';
import path from 'node:path';

const QPDF = 'vendor/qpdf/qpdf.exe';
const OUT = 'test/fixtures/_out';
const { addMergeBookmarks } = await import('./_outline.mjs');

const inspect = (p) => {
  const j = JSON.parse(execFileSync(QPDF,
    ['--json','--json-key=outlines','--json-key=acroform','--json-key=pages', p],
    { encoding: 'utf8', maxBuffer: 1 << 28 }));
  const flat = (i, d=0) => i.flatMap(x => [{t:x.title, p:x.destpageposfrom1, d}, ...flat(x.kids||[], d+1)]);
  return { pages: j.pages.length, form: j.acroform.hasacroform, outline: flat(j.outlines) };
};

async function scenario(name, inputs, expectPages) {
  const staged = `${OUT}/_m_staged.pdf`;
  const final  = `${OUT}/merged_${name}.pdf`;
  const [primary, ...rest] = inputs;
  execFileSync(QPDF, [primary, '--pages', '.', ...rest, '--', staged]);

  const counts = inputs.map(f => inspect(f).pages);
  let offset = counts[0];
  const marks = rest.map((f, i) => {
    const m = { title: path.basename(f).replace(/\.pdf$/i,''), page: offset + 1 };
    offset += counts[i+1];
    return m;
  });
  await addMergeBookmarks(staged, final, marks);

  const r = inspect(final);
  const ok = r.pages === expectPages;
  console.log(`\n--- ${name} --- pages ${r.pages}/${expectPages} ${ok?'OK':'MISMATCH'} form=${r.form}`);
  for (const o of r.outline) console.log('   ' + '  '.repeat(o.d) + `${o.t} -> p${o.p}`);
  return r;
}

// Path A: primary HAS an outline tree -> splice
await scenario('splice',
  ['test/fixtures/outlined-form.pdf','test/fixtures/beta.pdf','test/fixtures/gamma.pdf'], 15);

// Path B: primary has NO outline -> create root (the common case)
await scenario('create',
  ['test/fixtures/plain.pdf','test/fixtures/beta.pdf','test/fixtures/gamma.pdf'], 15);
