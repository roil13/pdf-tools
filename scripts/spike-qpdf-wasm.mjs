// Differential test: the vendored qpdf-wasm against the vendored native binary.
//
// Originally the Phase 0 gate that asked whether qpdf could run in WebAssembly
// at all. It now guards the build in `vendor/qpdf-wasm/`, which is compiled from
// qpdf 12.4.1 sources by the recipe in `scripts/build-qpdf-wasm.md`.
//
// It answers one question: does the WASM build behave like the real binary?
//   - the five real argv arrays, over every fixture, compared by reading each
//     output back with the NATIVE qpdf
//   - exit codes 0, 2 and 3, including recovery from a damaged xref
//   - stderr, which `errorKey()` turns into a translation key
//   - both encryption cases
//
// Run: node scripts/spike-qpdf-wasm.mjs
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const NATIVE = 'vendor/qpdf/qpdf.exe';
const OUT = 'test/fixtures/_out/wasm';
mkdirSync(OUT, { recursive: true });

let blockers = 0;
const limitations = [];
const check = (label, ok, detail = '') => {
  if (!ok) blockers++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};
const note = (label, detail) => {
  limitations.push(`${label} -- ${detail}`);
  console.log(`  NOTE  ${label}  ${detail}`);
};

// ---------------------------------------------------------------------------
// The runner. This mirrors src/platform/qpdfWasm.ts; if one changes, so must
// the other, because this is what proves that one correct.
//
// Two things here are qpdf's own behaviour rather than Emscripten's, and both
// were found the hard way:
//
// (a) callMain MUTATES the array it is given -- Emscripten unshifts argv[0] into
//     it in place. Reusing an args array corrupts every later call, reporting an
//     "unknown argument" you never passed. Always pass a copy.
//
// (b) qpdf's logger is a process-global singleton and the WASM "process" never
//     restarts between calls, so WHICHEVER STDOUT MODE IS USED FIRST WINS,
//     permanently. A plain write (`--version` suffices) makes every later
//     `--json` fail with "called setSave on standard output after standard
//     output has already been used". The module is warmed with a throwaway
//     `--json` before anything else can claim stdout.
//
// What is NOT here any more: a shim over the global console. The vendored build
// includes `print`/`printErr` in INCOMING_MODULE_JS_API, so capturing qpdf's
// output is an ordinary callback.
// ---------------------------------------------------------------------------
const VENDOR = 'vendor/qpdf-wasm';
const createModule = (await import(pathToFileURL(resolve(`${VENDOR}/qpdf.js`)).href)).default;

let sink = null;

const coldStart = Date.now();
const mod = await createModule({
  locateFile: () => resolve(`${VENDOR}/qpdf.wasm`),
  noInitialRun: true,
  print: (line) => sink?.out.push(line),
  printErr: (line) => sink?.err.push(line),
});
const coldMs = Date.now() - coldStart;

/**
 * The mini-filesystem contract. A plain `(args) => result` does not close,
 * because the argv ITSELF names files (pruneOutline passes a path inside
 * ['--json', '--json-key=outlines', file]), so inputs must be staged before the
 * call and outputs read back after it.
 */
function runQpdf(args, { inputs = {}, outputs = [] } = {}) {
  for (const name of outputs) { try { mod.FS.unlink(name); } catch { /* absent */ } }
  for (const [name, bytes] of Object.entries(inputs)) mod.FS.writeFile(name, bytes);

  sink = { out: [], err: [] };
  let exitCode;
  try {
    exitCode = mod.callMain([...args]);       // COPY -- see (a)
  } catch (e) {
    exitCode = typeof e?.status === 'number' ? e.status : 2;
    sink.err.push(String(e?.message ?? e));
  }
  const captured = sink;
  sink = null;

  const produced = {};
  for (const name of outputs) {
    try { produced[name] = mod.FS.readFile(name); } catch { /* not written */ }
  }
  return {
    exitCode,
    stdout: captured.out.join('\n'),
    stderr: captured.err.join('\n'),
    outputs: produced,
  };
}

// Claim stdout for JSON mode before anything else can -- see (b).
runQpdf(['--json', '--json-key=pages', '/__warmup_nonexistent.pdf']);

/**
 * qpdf's own version, from a THROWAWAY instance.
 *
 * `--version` is a plain stdout write, so asking the shared module for it would
 * claim stdout in the wrong mode and break every `--json` call afterwards. Doing
 * it on its own module is what `wasmQpdfVersion()` does in the app, for exactly
 * this reason.
 */
const wasmVerRaw = await (async () => {
  let vsink = null;
  const one = await createModule({
    locateFile: () => resolve(`${VENDOR}/qpdf.wasm`),
    noInitialRun: true,
    print: (line) => vsink?.push(line),
    printErr: () => {},
  });
  vsink = [];
  try { one.callMain(['--version']); } catch { /* exit status only */ }
  return vsink.join(String.fromCharCode(10)).trim();
})();

/** Read qpdf JSON out of the module, via stdout exactly as native does -- see (b). */
function wasmJson(args, inputs) {
  const r = runQpdf(args, { inputs });
  try { return JSON.parse(r.stdout); }
  catch (e) { return { error: `${e.message} | stderr: ${r.stderr.slice(0, 80)}` }; }
}

/** Native qpdf, for differential comparison. stderr piped so it cannot leak here. */
function native(args) {
  try {
    const stdout = execFileSync(NATIVE, args, {
      encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (e) {
    return { exitCode: e.status ?? 2, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

/**
 * Independent read-back: structure of a PDF, per the NATIVE binary.
 *
 * Rotation comes from pdf-lib, not qpdf: `--json-key=pages` does NOT expose
 * /Rotate. Without it the editPages case below would compare equal even if the
 * rotation were dropped or applied to the wrong page -- and --rotate page
 * numbering is the one trap this repo already documents (see Q6 above, and the
 * reason src/lib/rotation.ts exists).
 */
async function structure(file) {
  const j = JSON.parse(native([
    '--json', '--json-key=pages', '--json-key=acroform',
    '--json-key=encrypt', '--json-key=outlines', file,
  ]).stdout);
  const flat = (items) => (items ?? []).flatMap((i) => [i, ...flat(i.kids)]);
  const o = flat(j.outlines);
  let rotations = 'unreadable';
  try {
    const doc = await PDFDocument.load(readFileSync(file), { ignoreEncryption: true });
    rotations = doc.getPages().map((p) => p.getRotation().angle).join(',');
  } catch { /* reported as-is */ }
  return {
    pages: j.pages.length,
    rotations,
    form: j.acroform?.hasacroform ?? false,
    fields: (j.acroform?.fields ?? []).length,
    encrypted: j.encrypt?.encrypted ?? false,
    outlines: o.length,
    dead: o.filter((x) => x.destpageposfrom1 === null).length,
    titles: o.map((x) => x.title).join('|'),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fixture = (n) => new Uint8Array(readFileSync(`test/fixtures/${n}`));

// ===========================================================================
console.log('\n=== 0. Versions ===');
const nativeVer = native(['--version']).stdout.trim().split('\n')[0];
// argv[0] under WASM is the host script name, so match on the version only.
const nv = nativeVer.match(/(\d+\.\d+\.\d+)/)?.[1];
const wv = wasmVerRaw.match(/(\d+\.\d+\.\d+)/)?.[1];
check('--version is readable from its own instance', !!wv, wv ? '' : 'empty');
console.log(`  native : ${nv}`);
console.log(`  wasm   : ${wv}`);
check('same qpdf major version', nv?.split('.')[0] === wv?.split('.')[0], `${nv} vs ${wv}`);
if (nv !== wv) note('version skew', `${nv} (desktop) vs ${wv} (wasm); sections 2 and 4 show what it costs`);

// ===========================================================================
console.log('\n=== 1. Getting --json out of the module ===');
{
  const j = wasmJson(['--json', '--json-key=outlines', '/in.pdf'],
    { '/in.pdf': fixture('outlined-form.pdf') });
  check('--json reaches us through the printErr/print hooks', !j.error, j.error ?? '');
  check('has destpageposfrom1 (pruneOutline depends on it)',
    j?.outlines?.[0]?.destpageposfrom1 !== undefined);

  // Robustness: the shared instance must survive real usage patterns.
  const stillWorks = () => !wasmJson(['--json', '--json-key=outlines', '/in.pdf']).error;
  runQpdf(['/in.pdf', '/conv.pdf'], { outputs: ['/conv.pdf'] });
  check('survives a normal conversion', stillWorks());
  runQpdf(['/bad.pdf', '/x.pdf'],
    { inputs: { '/bad.pdf': new TextEncoder().encode('nope') }, outputs: ['/x.pdf'] });
  check('survives a FAILED conversion', stillWorks());
  runQpdf(['--version']);
  check('survives --version (app:versions calls it)', stillWorks());
  check('survives repeated calls', [0, 1, 2, 3].every(stillWorks));
}

// ===========================================================================
console.log('\n=== 2 & 3. Exit codes and stderr ===');
{
  const ok = runQpdf(['/in.pdf', '/o.pdf'],
    { inputs: { '/in.pdf': fixture('plain.pdf') }, outputs: ['/o.pdf'] });
  check('clean run exits 0 and writes output',
    ok.exitCode === 0 && (ok.outputs['/o.pdf']?.length ?? 0) > 0);

  const bad = runQpdf(['/bad.pdf', '/o.pdf'],
    { inputs: { '/bad.pdf': new TextEncoder().encode('not a pdf at all') }, outputs: ['/o.pdf'] });
  check('not-a-PDF exits 2', bad.exitCode === 2, `got ${bad.exitCode}`);
  check('stderr is captured', bad.stderr.length > 0, JSON.stringify(bad.stderr.slice(0, 55)));
  check('errorKey() can classify it as error.notPdf',
    /can.{0,2}t find pdf header|not a pdf file/i.test(bad.stderr));
  check('failed run yields NO stale output', !bad.outputs['/o.pdf']);

  // Exit 3 = warnings issued but output WAS written. The app resolves (not
  // rejects) on 3, so this distinction is what separates "repaired your damaged
  // file" from "refused your file". Native is the ground truth.
  const src = readFileSync('test/fixtures/outlined-form.pdf');
  const variants = {
    'bad startxref offset': () => {
      const b = Buffer.from(src);
      b.write('0000000042', b.indexOf('\n', b.lastIndexOf('startxref')) + 1);
      return b;
    },
    'startxref -> 0': () => {
      const b = Buffer.from(src);
      b.write('0000000000', b.indexOf('\n', b.lastIndexOf('startxref')) + 1);
      return b;
    },
    'truncated trailer': () => {
      const b = Buffer.from(src);
      return Buffer.concat([b.subarray(0, b.lastIndexOf('startxref')), Buffer.from('%%EOF\n')]);
    },
  };
  let anyThree = false;
  const gaps = [];
  for (const [label, make] of Object.entries(variants)) {
    const buf = make();
    const f = `${OUT}/damaged-${label.replace(/\W+/g, '_')}.pdf`;
    writeFileSync(f, buf);
    const n = native([f, `${f}.native.pdf`]).exitCode;
    const w = runQpdf(['/d.pdf', '/od.pdf'],
      { inputs: { '/d.pdf': new Uint8Array(buf) }, outputs: ['/od.pdf'] });
    if (w.exitCode === 3) anyThree = true;
    if (n === 3 && w.exitCode !== 3) gaps.push(`${label} (native 3 -> wasm ${w.exitCode})`);
    console.log(`        ${label.padEnd(22)} native=${n}  wasm=${w.exitCode}  out=${w.outputs['/od.pdf']?.length ?? 0}B`);
  }
  // Recovering a damaged xref is the reason this build exists. qpdf does it by
  // CATCHING the parse failure and reconstructing, which needs -fexceptions --
  // Emscripten disables exception catching by default, and without it every one
  // of these is refused outright instead of repaired.
  check('wasm repairs every file native repairs', gaps.length === 0, gaps.join('; '));
  check('exit code 3 is reachable', anyThree);
}

// ===========================================================================console.log('\n=== 4. The real operations, differentially, across every fixture ===');
// argv arrays from electron/operations.ts. NOTE the explicit 1-z on merge:
// qpdf 12.4.1 defaults an omitted --pages range to all pages, 12.2.0 rejects it
// with "invalid range syntax". 1-z means the same thing to BOTH, so writing it
// explicitly is the portable form (verified against the native binary below).
const INSPECT_KEYS = ['--json-key=pages', '--json-key=acroform',
                      '--json-key=encrypt', '--json-key=outlines'];

const pageCountOf = (f) =>
  JSON.parse(native(['--json', '--json-key=pages', f]).stdout).pages.length;

/** Ops for one fixture, with ranges that make sense for its page count. */
function opsFor(pc) {
  const reorder = pc >= 2 ? `${pc},1-${pc - 1}` : '1';   // move last page to front
  const slice = pc >= 4 ? '2-4' : `1-${pc}`;
  return [
    { name: 'inspect', json: true, keys: INSPECT_KEYS },
    { name: 'prune(outlines)', json: true, keys: ['--json-key=outlines'] },
    { name: 'editPages', args: (i, o) => [i, '--pages', '.', reorder, '--', '--rotate=+90:1', o] },
    { name: 'split', args: (i, o) => [i, '--pages', '.', slice, '--', o] },
    { name: 'compress', args: (i, o) => ['--recompress-flate', '--compression-level=9',
                                         '--object-streams=generate', '--compress-streams=y', i, o] },
  ];
}

const FIXTURES = ['blank.pdf', 'plain.pdf', 'beta.pdf', 'gamma.pdf', 'scan.pdf', 'outlined-form.pdf'];

for (const fx of FIXTURES) {
  const src = `test/fixtures/${fx}`;
  const pc = pageCountOf(src);
  const results = [];
  for (const c of opsFor(pc)) {
    if (c.json) {
      const n = JSON.parse(native(['--json', ...c.keys, src]).stdout);
      const w = wasmJson(['--json', ...c.keys, '/in.pdf'], { '/in.pdf': fixture(fx) });
      // `version` is the qpdf JSON schema version; the payload is what must match.
      delete n.version; delete w.version;
      results.push([c.name, !w.error && same(n, w), w.error ?? '']);
    } else {
      const slug = `${fx.replace(/\W+/g, '_')}.${c.name.replace(/\W+/g, '_')}`;
      const nOut = `${OUT}/${slug}.native.pdf`;
      const wOut = `${OUT}/${slug}.wasm.pdf`;
      native(c.args(src, nOut));
      const r = runQpdf(c.args('/in.pdf', '/o.pdf'),
        { inputs: { '/in.pdf': fixture(fx) }, outputs: ['/o.pdf'] });
      if (!r.outputs['/o.pdf']) {
        results.push([c.name, false, `no output (exit ${r.exitCode}) ${r.stderr.slice(0, 50)}`]);
        continue;
      }
      writeFileSync(wOut, Buffer.from(r.outputs['/o.pdf']));
      const a = await structure(nOut), b = await structure(wOut);
      const ok = same(a, b);
      results.push([c.name, ok, ok ? ''
        : `\n           native=${JSON.stringify(a)}\n           wasm  =${JSON.stringify(b)}`]);

      // compress must not merely preserve structure -- it must actually compress.
      // On a text fixture the delta is noise; scan.pdf is the one with real image
      // data, so compare the SIZE RATIO, which structure() could never notice.
      if (c.name === 'compress') {
        const nSize = statSync(nOut).size, wSize = statSync(wOut).size;
        const drift = Math.abs(nSize - wSize) / nSize;
        results.push([`compress size (${statSync(src).size}B -> n:${nSize} w:${wSize})`,
          drift < 0.05, drift < 0.05 ? '' : `${(drift * 100).toFixed(1)}% apart`]);
      }
    }
  }
  const bad = results.filter(([, ok]) => !ok);
  console.log(`  ${fx} (${pc}p)`);
  for (const [name, ok, detail] of results) check(`  ${name}`, ok, detail);
  if (!bad.length) { /* all good */ }
}

// merge: two inputs, and the 1-z portability fix
{
  const nOutOld = `${OUT}/merge.native.norange.pdf`;
  const nOut = `${OUT}/merge.native.pdf`;
  const wOut = `${OUT}/merge.wasm.pdf`;
  const A = 'test/fixtures/outlined-form.pdf', B = 'test/fixtures/beta.pdf';

  // the form the app ships today, and the portable form, must agree on native
  native([A, '--pages', '.', B, '--', nOutOld]);
  native([A, '--pages', '.', '1-z', B, '1-z', '--', nOut]);
  check('1-z is a no-op on native qpdf (safe to adopt)',
    same(await structure(nOutOld), await structure(nOut)));

  const r = runQpdf(['/a.pdf', '--pages', '.', '1-z', '/b.pdf', '1-z', '--', '/o.pdf'], {
    inputs: { '/a.pdf': fixture('outlined-form.pdf'), '/b.pdf': fixture('beta.pdf') },
    outputs: ['/o.pdf'],
  });
  if (r.outputs['/o.pdf']) {
    writeFileSync(wOut, Buffer.from(r.outputs['/o.pdf']));
    const a = await structure(nOut), b = await structure(wOut);
    check('merge(multi-input)', same(a, b), same(a, b) ? ''
      : `\n         native=${JSON.stringify(a)}\n         wasm  =${JSON.stringify(b)}`);
  } else check('merge(multi-input)', false, `no output (exit ${r.exitCode}) ${r.stderr.slice(0, 60)}`);
}

// ===========================================================================
console.log('\n=== 4b. Encrypted input ===');
// --json-key=encrypt is one of the four keys inspect() requests, and the app has
// a whole user-facing path for password-protected files (error.encrypted). Every
// checked-in fixture is unencrypted, so that comparison was trivially equal.
// Make a real one with the native binary and check BOTH sides detect it.
// There are TWO distinct cases and the app handles them by different routes.
{
  // (i) Owner password only, empty user password. qpdf CAN open this, so
  //     inspect() succeeds and reports isEncrypted: true -- this is the path
  //     that actually exercises --json-key=encrypt.
  const openable = `${OUT}/encrypted-owner-only.pdf`;
  native(['--encrypt', '', 'ownerpw', '256', '--', 'test/fixtures/outlined-form.pdf', openable]);
  const nRaw = native(['--json', '--json-key=encrypt', openable]);
  let n = null;
  try { n = JSON.parse(nRaw.stdout); } catch { /* reported below */ }
  check('owner-only fixture is readable and encrypted', n?.encrypt?.encrypted === true,
    n ? '' : `native exit ${nRaw.exitCode}`);
  const w = wasmJson(['--json', '--json-key=encrypt', '/enc.pdf'],
    { '/enc.pdf': new Uint8Array(readFileSync(openable)) });
  check('wasm agrees: encrypted true', w?.encrypt?.encrypted === true, w.error ?? '');
  check('wasm encrypt block matches native exactly',
    !w.error && same(n.encrypt, w.encrypt));

  // (ii) A real user password. qpdf cannot open it at all, so inspect() throws
  //      and errorKey() must classify the stderr as error.encrypted -- that is
  //      what surfaces the "password-protected" message to the user.
  const locked = `${OUT}/encrypted-user-pw.pdf`;
  native(['--encrypt', 'userpw', 'ownerpw', '256', '--', 'test/fixtures/outlined-form.pdf', locked]);
  const nLocked = native(['--json', '--json-key=encrypt', locked]);
  check('native refuses a user-password file', nLocked.exitCode !== 0, `exit ${nLocked.exitCode}`);
  const r = runQpdf(['--json', '--json-key=encrypt', '/locked.pdf'],
    { inputs: { '/locked.pdf': new Uint8Array(readFileSync(locked)) } });
  check('wasm refuses it too', r.exitCode !== 0, `exit ${r.exitCode}`);
  check('errorKey() can classify it as error.encrypted',
    /password/i.test(r.stderr), JSON.stringify(r.stderr.slice(0, 70)));
  check('native and wasm agree on the refusal', r.exitCode === nLocked.exitCode,
    `native=${nLocked.exitCode} wasm=${r.exitCode}`);
}
// ===========================================================================
console.log('\n=== 5. Cost ===');
const wasmBytes = statSync(`${VENDOR}/qpdf.wasm`).size;
const glueBytes = statSync(`${VENDOR}/qpdf.js`).size;
const nativeBytes = ['qpdf.exe', 'qpdf30.dll'].reduce((s, f) => s + statSync(`vendor/qpdf/${f}`).size, 0);
console.log(`  wasm + glue : ${((wasmBytes + glueBytes) / 1e6).toFixed(2)} MB`);
console.log(`  native (ref): ${(nativeBytes / 1e6).toFixed(2)} MB`);
console.log(`  cold start  : ${coldMs} ms (desktop node; measure again on device)`);

// ===========================================================================
if (limitations.length) {
  console.log('\n=== Limitations (not blockers -- a product decision) ===');
  for (const l of limitations) console.log(`  - ${l}`);
}
console.log(`\n${blockers === 0 ? 'GATE PASSED' : `GATE FAILED (${blockers} blocker${blockers === 1 ? '' : 's'})`}`);
console.log(`${limitations.length} limitation${limitations.length === 1 ? '' : 's'} recorded.\n`);
process.exit(blockers === 0 ? 0 : 1);
