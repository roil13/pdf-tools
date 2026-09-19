/**
 * The Electron implementation of `Platform`.
 *
 * This is the ONLY file in `src/` that knows a handle's `id` is a filesystem
 * path, and the only one that touches `window.api`. The IPC wire contract it
 * speaks -- absolute path strings, every channel returning an `Envelope` -- is
 * unchanged; the translation to and from handles happens here.
 */
import type {
  PdfInfo, EditPagesRequest, MergeRequest, SplitRequest, CompressRequest,
  OpResult, CompressResult, SplitResult, SplitPart,
} from '../../shared/types.js';
import { IpcError } from '../lib/errors.js';
import type {
  Platform, DocRef, DestRef, DocInfo, OpOutcome,
} from './types.js';

/**
 * Every IPC handler returns this envelope so main-process errors survive the hop.
 *
 * Failures carry a translation KEY plus the original text, never prose: the main
 * process has no idea what language the interface is in.
 */
type Envelope<T> =
  | { ok: true; value: T }
  | { ok: false; key?: string; detail?: string };

interface RawApi {
  pathForFile(file: File): string;
  openPdfs(multi: boolean): Promise<Envelope<string[]>>;
  openImages(): Promise<Envelope<string[]>>;
  chooseFolder(): Promise<Envelope<string | null>>;
  saveAs(suggestedName: string): Promise<Envelope<string | null>>;
  readFile(p: string): Promise<Envelope<Uint8Array>>;
  writeFile(p: string, bytes: Uint8Array): Promise<Envelope<string>>;
  existsIn(dir: string, name: string): Promise<Envelope<boolean>>;
  inspect(p: string): Promise<Envelope<PdfInfo>>;
  editPages(r: EditPagesRequest): Promise<Envelope<OpResult>>;
  merge(r: MergeRequest): Promise<Envelope<OpResult>>;
  split(r: SplitRequest): Promise<Envelope<SplitResult>>;
  compress(r: CompressRequest): Promise<Envelope<CompressResult>>;
  revealInFolder(p: string): Promise<Envelope<void>>;
  openFile(p: string): Promise<Envelope<void>>;
  versions(): Promise<Envelope<Record<string, string>>>;
}

declare global {
  interface Window { api: RawApi }
}

/** Unwrap the envelope, turning a main-process failure into a thrown IpcError. */
async function un<T>(p: Promise<Envelope<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new IpcError(r.key, r.detail);
  return r.value;
}

/**
 * Last path segment. Local to this file on purpose: deriving a display name
 * from an identifier is a desktop-only trick, and a host whose ids are content
 * URIs has to get the name from the picker instead.
 */
function baseName(p: string): string {
  return p.split(/[\/]/).pop() ?? p;
}

const doc = (path: string): DocRef => ({ id: path, name: baseName(path) });
const dest = (path: string): DestRef => ({ id: path, name: baseName(path) });

function toDocInfo(info: PdfInfo): DocInfo {
  return {
    ref: { id: info.path, name: info.name },
    pageCount: info.pageCount,
    sizeBytes: info.sizeBytes,
    hasOutlines: info.hasOutlines,
    hasAcroForm: info.hasAcroForm,
    isEncrypted: info.isEncrypted,
    outline: info.outline,
  };
}

export const electronPlatform: Platform = {
  capabilities: { revealInFolder: true, openExternal: true, camera: false },

  // Electron 32 removed File.path; webUtils.getPathForFile is the only way
  // to turn a dropped File back into a filesystem path.
  filesToRefs: (files) => files
    .map((f) => window.api.pathForFile(f))
    .filter(Boolean)
    .map(doc),

  openPdfs: async (multi) => (await un(window.api.openPdfs(multi))).map(doc),
  openImages: async () => (await un(window.api.openImages())).map(doc),
  chooseFolder: async () => {
    const dir = await un(window.api.chooseFolder());
    return dir ? dest(dir) : null;
  },
  saveAs: async (name) => {
    const p = await un(window.api.saveAs(name));
    return p ? dest(p) : null;
  },

  // Strip a trailing .pdf then append, rather than substituting: a name that
  // does not end in .pdf made the substitution a no-op, and the companion file
  // then overwrote the PDF that had just been written. Returning null in that
  // case is what keeps the caller from writing over its own output.
  siblingWithExtension: (d, ext) => {
    const sibling = `${d.id.replace(/\.pdf$/i, '')}.${ext}`;
    return sibling === d.id ? null : dest(sibling);
  },

  readFile: (ref) => un(window.api.readFile(ref.id)),
  writeFile: async (d, bytes) => dest(await un(window.api.writeFile(d.id, bytes))),
  existsIn: (dir, name) => un(window.api.existsIn(dir.id, name)),

  inspect: async (ref) => toDocInfo(await un(window.api.inspect(ref.id))),

  editPages: async (input, output, opts) => toOutcome(
    await un(window.api.editPages({
      input: input.id,
      output: output.id,
      keep: opts.keep,
      rotations: opts.rotations,
      reordered: opts.reordered,
    })),
  ),

  merge: async (inputs, output, generateBookmarks) => toOutcome(
    await un(window.api.merge({
      inputs: inputs.map((r) => r.id),
      output: output.id,
      generateBookmarks,
    })),
  ),

  split: async (input, outputDir, parts: SplitPart[]) => {
    const res = await un(window.api.split({
      input: input.id, outputDir: outputDir.id, parts,
    }));
    return { outputs: res.outputs.map(dest), warnings: res.warnings };
  },

  compress: async (input, output) => {
    const res = await un(window.api.compress({ input: input.id, output: output.id }));
    return { ...toOutcome(res), beforeBytes: res.beforeBytes, afterBytes: res.afterBytes };
  },

  // No desktop scanner. The capability is false, so nothing calls this.
  scanDocument: async () => [],

  revealInFolder: (ref) => un(window.api.revealInFolder(ref.id)),
  openFile: (ref) => un(window.api.openFile(ref.id)),
  versions: () => un(window.api.versions()),
};

function toOutcome(res: OpResult): OpOutcome {
  return { output: dest(res.output), warnings: res.warnings, bookmarks: res.bookmarks };
}
