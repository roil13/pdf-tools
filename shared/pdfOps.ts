/**
 * The five PDF operations, written once for every platform.
 *
 * Everything here works in terms of NAMES the host understands. Under Electron a
 * name is an absolute path and qpdf reads the user's file where it lies; under
 * qpdf-wasm it is a path inside the module's in-memory filesystem. The operations
 * never build, parse or join a name themselves -- `QpdfHost` does that -- which is
 * what lets the same code drive a spawned binary and a WASM module.
 *
 * This is deliberately NOT a bytes-in/bytes-out interface. Forcing bytes would
 * make the desktop read every input into memory and write a second copy just to
 * hand it to a process that could have streamed it off disk.
 */
import { formatRanges } from '../src/lib/pageRanges.js';
import { rotationArgs } from '../src/lib/rotation.js';
import { addMergeBookmarks } from './outline.js';
import { pruneDeadBookmarks, needsPruning, type QpdfOutline } from './pruneOutline.js';
import type {
  PdfInfo, OutlineEntry, EditPagesRequest, MergeRequest, SplitRequest,
  CompressRequest, OpResult, CompressResult, SplitResult,
} from './types.js';

/** Raised for a problem the operation itself detects, named by translation key. */
export class OpError extends Error {
  constructor(readonly messageKey: string, readonly detail?: string) {
    super(messageKey);
    this.name = 'OpError';
  }
}

/**
 * Parse qpdf's `--json` output, saying what arrived when it is not JSON.
 *
 * A bare `JSON.parse` failure reports a character offset and nothing else, and
 * the text it choked on is gone by the time anyone reads the message -- which
 * makes it unactionable from a phone, where there is no console to go and look.
 * qpdf writes diagnostics to stderr and JSON to stdout, so anything unparseable
 * here means either the two got crossed or the run produced nothing at all, and
 * the first 200 characters say immediately which.
 */
function parseQpdfJson<T>(stdout: string, what: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (err) {
    throw new OpError(
      'error.qpdfJson',
      `${what}: ${(err as Error).message}. qpdf wrote ${stdout.length} characters`
      + `${stdout.length ? `, starting: ${JSON.stringify(stdout.slice(0, 200))}` : ' (nothing at all)'}`,
    );
  }
}

export interface QpdfResult {
  stdout: string;
  /** Present when qpdf exited 3: output was written, but with complaints. */
  warnings?: string;
}

/**
 * What an operation needs from its host: a way to run qpdf, and the few
 * filesystem verbs the orchestration uses.
 */
export interface QpdfHost {
  /** Run qpdf. Resolves with warnings on exit 3; rejects on anything worse. */
  run(args: string[]): Promise<QpdfResult>;
  /** A scratch name nothing else is using. `tag` only aids debugging. */
  temp(tag: string): string;
  read(name: string): Promise<Uint8Array>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  /** Best-effort; a missing file is not an error. */
  remove(name: string): Promise<void>;
  size(name: string): Promise<number>;
  join(dir: string, name: string): string;
  baseName(name: string): string;
}

/** Shape of the bits of `qpdf --json` we rely on (verified against qpdf 12.4.1). */
interface QpdfJson {
  pages: unknown[];
  acroform: { hasacroform: boolean };
  encrypt: { encrypted: boolean };
  outlines: QpdfOutline[];
}

function flattenOutline(items: QpdfOutline[], depth = 0): OutlineEntry[] {
  return items.flatMap((it) => [
    { title: it.title, page: it.destpageposfrom1, depth },
    ...flattenOutline(it.kids ?? [], depth + 1),
  ]);
}

export interface PdfOps {
  inspect(file: string): Promise<PdfInfo>;
  editPages(req: EditPagesRequest): Promise<OpResult>;
  merge(req: MergeRequest): Promise<OpResult>;
  split(req: SplitRequest): Promise<SplitResult>;
  compress(req: CompressRequest): Promise<CompressResult>;
}

export function makePdfOps(host: QpdfHost): PdfOps {
  /**
   * Prune an outline in place, between a staged qpdf output and its destination.
   *
   * The qpdf `--json` call lives here rather than inside the algorithm because
   * only the host can run qpdf, and qpdf is what resolves named destinations
   * through the /Names tree -- reimplementing that is the thing the algorithm
   * exists to avoid.
   */
  async function pruneInto(
    staged: string, output: string, sortByPage: boolean,
  ): Promise<{ removed: number; retargeted: number }> {
    const { stdout } = await host.run(['--json', '--json-key=outlines', staged]);
    const outlines = parseQpdfJson<{ outlines?: QpdfOutline[] }>(stdout, 'reading the outline').outlines ?? [];

    // Decide from the outline tree before touching the document. When there is
    // nothing to fix this stays a copy, rather than reading the whole file into
    // memory only to write the same bytes back out.
    if (!needsPruning(outlines, sortByPage)) {
      await host.copy(staged, output);
      return { removed: 0, retargeted: 0 };
    }

    const result = await pruneDeadBookmarks(await host.read(staged), outlines, { sortByPage });
    await host.write(output, result.bytes);
    return { removed: result.removed, retargeted: result.retargeted };
  }

  const inspect: PdfOps['inspect'] = async (file) => {
    // --json-key limits the payload: without it qpdf serialises the whole object
    // graph, which is enormous for large documents.
    const { stdout } = await host.run([
      '--json', '--json-key=pages', '--json-key=acroform',
      '--json-key=encrypt', '--json-key=outlines', file,
    ]);
    const j = parseQpdfJson<QpdfJson>(stdout, 'inspecting the document');
    return {
      path: file,
      name: host.baseName(file),
      pageCount: j.pages.length,
      sizeBytes: await host.size(file),
      hasOutlines: (j.outlines ?? []).length > 0,
      hasAcroForm: j.acroform?.hasacroform ?? false,
      isEncrypted: j.encrypt?.encrypted ?? false,
      outline: flattenOutline(j.outlines ?? []),
    };
  };

  /**
   * Extract / delete / rotate / reorder -- one qpdf call.
   *
   * `keep` is an ORDER, not a set: qpdf honours "8,1-7" as an output sequence,
   * so rearranging pages is the same operation as selecting them. Bookmark
   * destinations follow the page objects on their own, because PDF destinations
   * reference pages by indirect reference rather than by index.
   *
   * CRITICAL (verified in the Step 0 spike): `--rotate` page ranges refer to
   * OUTPUT numbering, not input. The UI tracks rotations against SOURCE page
   * numbers, so each rotation is remapped to its position within `keep` first.
   */
  const editPages: PdfOps['editPages'] = async (req) => {
    if (req.keep.length === 0) throw new OpError('error.selectAtLeastOnePage');

    // qpdf writes to a temp name first: the outline still has to be pruned, and
    // a failure part-way through must never leave a half-written output.
    const staged = host.temp('edit');
    try {
      const { warnings } = await host.run([
        req.input, '--pages', '.', formatRanges(req.keep), '--',
        ...rotationArgs(req.keep, req.rotations),
        staged,
      ]);
      const bookmarks = await pruneInto(staged, req.output, req.reordered === true);
      return { output: req.output, warnings, bookmarks };
    } finally {
      await host.remove(staged);
    }
  };

  /**
   * Merge. Phase 1 is qpdf with the first file as PRIMARY input, so its outlines,
   * form fields and tags survive. Phase 2 adds one top-level bookmark per
   * appended file, because qpdf drops document-level structure from secondaries.
   */
  const merge: PdfOps['merge'] = async (req) => {
    if (req.inputs.length < 2) throw new OpError('error.needTwoPdfs');

    const [primary, ...rest] = req.inputs;
    const staged = host.temp('merge');

    try {
      // Every file gets an explicit `1-z`. qpdf 12.4.1 defaults an omitted range
      // to all pages; 12.2.0 -- the version the WASM build compiles -- rejects
      // it with "invalid range syntax". `1-z` means the same to both.
      const { warnings } = await host.run([
        primary, '--pages', '.', '1-z', ...rest.flatMap((f) => [f, '1-z']), '--', staged,
      ]);

      if (req.generateBookmarks && rest.length) {
        // Where each appended file starts in the merged document.
        const counts: number[] = [];
        for (const f of req.inputs) counts.push((await inspect(f)).pageCount);
        let offset = counts[0];
        const marks = rest.map((file, i) => {
          const mark = { title: host.baseName(file).replace(/\.pdf$/i, ''), page: offset + 1 };
          offset += counts[i + 1];
          return mark;
        });
        await host.write(req.output, await addMergeBookmarks(await host.read(staged), marks));
      } else {
        await host.copy(staged, req.output);
      }
      return { output: req.output, warnings };
    } finally {
      await host.remove(staged);
    }
  };

  /**
   * Split into several files. One qpdf call per part, so each output keeps its
   * document-level structure -- qpdf's own --split-pages explicitly does not.
   */
  const split: PdfOps['split'] = async (req) => {
    const outputs: string[] = [];
    const allWarnings: string[] = [];

    for (const part of req.parts) {
      const out = host.join(req.outputDir, part.fileName);
      const staged = host.temp('split');
      try {
        const { warnings } = await host.run([
          req.input, '--pages', '.', formatRanges(part.pages), '--', staged,
        ]);
        // Each piece keeps only the bookmarks that land inside it.
        await pruneInto(staged, out, false);
        if (warnings) allWarnings.push(`${part.fileName}: ${warnings}`);
      } finally {
        await host.remove(staged);
      }
      outputs.push(out);
    }
    return { outputs, warnings: allWarnings.join('\n') || undefined };
  };

  /** Lossless structural compression. No image downsampling, so scans barely shrink. */
  const compress: PdfOps['compress'] = async (req) => {
    const before = await host.size(req.input);

    // Staged like every other operation: qpdf writes progressively, so failing
    // straight into the user's chosen path could truncate a file they already had.
    const staged = host.temp('compress');
    try {
      const { warnings } = await host.run([
        '--recompress-flate', '--compression-level=9',
        '--object-streams=generate', '--compress-streams=y',
        req.input, staged,
      ]);
      const after = await host.size(staged);
      await host.copy(staged, req.output);
      return { output: req.output, beforeBytes: before, afterBytes: after, warnings };
    } finally {
      await host.remove(staged);
    }
  };

  return { inspect, editPages, merge, split, compress };
}
