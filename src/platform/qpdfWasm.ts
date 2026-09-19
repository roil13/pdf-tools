/**
 * The qpdf host backed by the vendored WebAssembly build of qpdf 12.4.1.
 *
 * `vendor/qpdf-wasm/` is built from source by `scripts/build-qpdf-wasm.md`, and
 * two of its build flags are load-bearing:
 *
 *  - **`-fexceptions`**. Emscripten disables exception CATCHING by default, and
 *    qpdf recovers from a damaged cross-reference table by catching the parse
 *    failure and reconstructing. Without the flag that throw is fatal, and every
 *    damaged file a desktop qpdf would silently repair is refused instead. This
 *    is what the published `@neslinesli93/qpdf-wasm` package gets wrong, and it
 *    reads like a qpdf version difference rather than a build one.
 *  - **`print` and `printErr` in `INCOMING_MODULE_JS_API`**. Without them
 *    Emscripten drops the hooks entirely and writes to `console` instead, so
 *    capturing qpdf's output means shimming the global console before the module
 *    is instantiated. With them it is an ordinary callback.
 *
 * Two things remain true of any build, because they are qpdf's own behaviour
 * rather than Emscripten's, and both were found empirically (see
 * `docs/spike-findings.md`):
 *
 * (a) `callMain` MUTATES the array it is given -- Emscripten unshifts argv[0]
 *     into it in place. Reusing an args array corrupts every later call,
 *     reporting an "unknown argument" you never passed. Always pass a copy.
 *
 * (b) qpdf's logger is a process-global singleton and the WASM "process" never
 *     restarts between calls, so WHICHEVER STDOUT MODE IS USED FIRST WINS,
 *     permanently. A plain write (`--version` is enough) makes every later
 *     `--json` fail with "called setSave on standard output after standard
 *     output has already been used". The module is therefore warmed with a
 *     throwaway `--json` before anything else can claim stdout.
 *
 * (c) MEMFS persists across calls, so a name must never be reused. Every scratch
 *     name from `temp()` carries a counter, which is what makes that true --
 *     and is why nothing here deletes files before a run. An earlier version
 *     tried to unlink "the output" by taking the last positional argument, which
 *     is correct for a conversion and WRONG for `--json`, where the last
 *     positional is the INPUT. It deleted the document before qpdf could read it,
 *     and the app reported "that file could not be found" about a file the user
 *     had just picked.
 */
import type { QpdfHost, QpdfResult } from '../../shared/pdfOps.js';
import { IpcError } from '../lib/errors.js';

type QpdfModule = {
  callMain(args: string[]): number;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
    mkdir(path: string): void;
    stat(path: string): { size: number };
  };
};

type Factory = (opts: {
  locateFile: () => string;
  noInitialRun: boolean;
  print: (line: string) => void;
  printErr: (line: string) => void;
}) => Promise<QpdfModule>;

/** Where qpdf's output goes while it is running, or null when it is not. */
let sink: { out: string[]; err: string[] } | null = null;

let modulePromise: Promise<QpdfModule> | null = null;

async function getModule(): Promise<QpdfModule> {
  if (modulePromise) return modulePromise;

  modulePromise = (async () => {
    const mod = await instantiate();
    // Claim stdout for JSON mode before anything else can -- see (b). The file
    // does not exist, which is the point: it costs nothing and cannot fail in a
    // way that matters.
    invoke(mod, ['--json', '--json-key=pages', '/__warmup_nonexistent.pdf']);
    return mod;
  })();

  return modulePromise;
}

/** A fresh module, wired to report qpdf's output through `sink`. */
async function instantiate(): Promise<QpdfModule> {
  const [{ default: createModule }, { default: wasmUrl }] = await Promise.all([
    import('../../vendor/qpdf-wasm/qpdf.js') as unknown as Promise<{ default: Factory }>,
    import('../../vendor/qpdf-wasm/qpdf.wasm?url') as unknown as Promise<{ default: string }>,
  ]);
  return createModule({
    locateFile: () => wasmUrl,
    noInitialRun: true,
    print: (line: string) => sink?.out.push(line),
    printErr: (line: string) => sink?.err.push(line),
  });
}

/** One synchronous qpdf run with its output captured. */
function invoke(mod: QpdfModule, args: string[]): { exitCode: number; stdout: string; stderr: string } {
  sink = { out: [], err: [] };
  let exitCode: number;
  try {
    exitCode = mod.callMain([...args]);          // COPY -- see (b)
  } catch (e) {
    const status = (e as { status?: number })?.status;
    exitCode = typeof status === 'number' ? status : 2;
    sink.err.push(String((e as Error)?.message ?? e));
  }
  const captured = sink;
  sink = null;
  return {
    exitCode,
    stdout: captured.out.join('\n'),
    stderr: captured.err.join('\n'),
  };
}

/**
 * Classify qpdf's terse stderr into a translation key.
 *
 * Deliberately the same mapping as `electron/qpdf.ts`, so a malformed file
 * produces the same message on a phone as on the desktop. Duplicated rather than
 * imported because that module imports `electron`.
 */
function errorKey(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('invalid password') || s.includes('password')) return 'error.encrypted';
  if (s.includes('not a pdf file')
    || s.includes('can’t find pdf header')
    || s.includes("can't find pdf header")) return 'error.notPdf';
  if (s.includes('no such file')) return 'error.missing';
  return 'error.qpdf';
}

let counter = 0;

/**
 * The mobile implementation of `QpdfHost`.
 *
 * Names are paths inside MEMFS. The platform adapter stages the user's document
 * there before an operation and reads the result out afterwards, because a phone
 * has no filesystem qpdf could read directly.
 */
export const wasmHost: QpdfHost = {
  async run(args: string[]): Promise<QpdfResult> {
    const mod = await getModule();
    const { exitCode, stdout, stderr } = invoke(mod, args);
    if (exitCode === 0) return { stdout };
    // Exit 3 is "warnings issued, but the output WAS written", which the app
    // surfaces rather than treating as a failure. qpdf-wasm 12.2.0 has never
    // been observed to produce it -- see the limitation in docs/spike-findings.md.
    if (exitCode === 3) return { stdout, warnings: stderr.trim() };
    throw new IpcError(errorKey(stderr), stderr.trim());
  },

  temp: (tag) => `/tmp-${tag}-${++counter}.pdf`,

  async read(name) {
    const mod = await getModule();
    return mod.FS.readFile(name);
  },

  async write(name, bytes) {
    const mod = await getModule();
    mod.FS.writeFile(name, bytes);
  },

  async copy(from, to) {
    const mod = await getModule();
    mod.FS.writeFile(to, mod.FS.readFile(from));
  },

  async remove(name) {
    const mod = await getModule();
    try { mod.FS.unlink(name); } catch { /* best effort */ }
  },

  async size(name) {
    const mod = await getModule();
    return mod.FS.stat(name).size;
  },

  // MEMFS is a flat POSIX filesystem, so these are the simple spellings rather
  // than anything platform-aware.
  join: (dir, name) => `${dir.replace(/\/+$/, '')}/${name}`,
  baseName: (name) => name.split('/').pop() ?? name,
};

/**
 * qpdf's own version, for the About screen.
 *
 * Needs its OWN module instance: once the shared one has claimed stdout for JSON
 * mode (c), a plain write like `--version` no longer reaches the shim and comes
 * back empty. It is called once, so the extra instantiation costs nothing.
 */
export async function wasmQpdfVersion(): Promise<string> {
  const one = await instantiate();
  const { stdout } = invoke(one, ['--version']);
  return stdout.trim().split('\n')[0]?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? '';
}
