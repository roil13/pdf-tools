/**
 * The Android implementation of `Platform`.
 *
 * The shape of a handle is the whole reason `src/platform/` exists. Under
 * Electron an id is an absolute path; here it is whatever the host gave us --
 * usually a `content://` URI from the Storage Access Framework, which cannot be
 * parsed, joined or reconstructed. Nothing outside this file may look inside one.
 *
 * Documents live in two places at once and the difference matters:
 *
 *  - The SAF URI the user picked, which is the only thing that can be read from
 *    or written to outside the app's sandbox.
 *  - A copy inside qpdf-wasm's in-memory filesystem, which is the only thing
 *    qpdf can see. Every operation stages into MEMFS, runs, and reads back.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileSharer } from '@capgo/capacitor-file-sharer';
import { DocumentScanner, ResponseType } from '@capgo/capacitor-document-scanner';
import { makePdfOps, OpError } from '../../shared/pdfOps.js';
import { wasmHost, wasmQpdfVersion } from './qpdfWasm.js';
import { IpcError } from '../lib/errors.js';
import type {
  Platform, DocRef, DestRef, DocInfo, OpOutcome, CompressOutcome, SplitOutcome,
} from './types.js';
import type { PdfInfo, OpResult, SplitPart } from '../../shared/types.js';

const ops = makePdfOps(wasmHost);

/**
 * The app's own Android plugin, source in `native/android/`.
 *
 * It exists because nothing published does this. Android has no filesystem an
 * app may write to freely, and `@capacitor/filesystem` refuses a `content://`
 * URI outright -- "'writeFile' not supported for content:// URIs" -- even for a
 * folder the user explicitly granted. Without it the only way to deliver a
 * finished file is the share sheet, which is not "save it where I said".
 */
interface DocumentStorePlugin {
  /** The system Save-as dialog. `cancelled` when the user backs out. */
  createDocument(opts: { suggestedName: string; mimeType: string }): Promise<{
    cancelled: boolean; uri?: string; name?: string;
  }>;
  /** A new file inside a folder granted earlier by `pickDirectory`. */
  createInTree(opts: { treeUri: string; name: string; mimeType: string }): Promise<{
    uri: string; name: string;
  }>;
  writeDocument(opts: { uri: string; data: string }): Promise<void>;
}

const DocumentStore = registerPlugin<DocumentStorePlugin>('DocumentStore');

/* --------------------------------------------------------------- base64 */

/**
 * Capacitor moves file contents across the bridge as base64 strings, so every
 * read and write pays this conversion. Done in chunks because
 * `String.fromCharCode(...bytes)` on a multi-megabyte array overflows the
 * argument stack -- a failure that only shows up on real documents.
 */
const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------- staging */

/**
 * Where a document lives while qpdf works on it.
 *
 * `id` is the SAF URI the user knows about; `memfs` is the name qpdf uses. The
 * map is what lets `editPages(input, output)` receive handles and hand qpdf
 * names, without either side learning about the other.
 */
const staged = new Map<string, string>();
let stageCounter = 0;

async function stageIn(ref: DocRef): Promise<string> {
  const existing = staged.get(ref.id);
  if (existing) return existing;

  const name = `/in-${++stageCounter}.pdf`;
  await wasmHost.write(name, await readBytes(ref));
  staged.set(ref.id, name);
  return name;
}

/** A MEMFS name for something qpdf will write, that nothing will read as input. */
function stageOut(hint: string): string {
  return `/out-${++stageCounter}-${hint}`;
}

async function readBytes(ref: DocRef): Promise<Uint8Array> {
  const res = await Filesystem.readFile({ path: ref.id });
  // A string is base64; a Blob comes back on the web implementation.
  return typeof res.data === 'string'
    ? fromBase64(res.data)
    : new Uint8Array(await (res.data as Blob).arrayBuffer());
}

/* ------------------------------------------------------------- writing */

/**
 * Put bytes where the user asked for them.
 *
 * `dest.id` is either a real location the Storage Access Framework gave us, or
 * the sentinel below meaning "we have nowhere to put this yet, so hand it to the
 * system sheet and let the user choose an app to receive it".
 *
 * The sheet is not a lesser fallback for its own sake -- on Android it is the
 * only route that always exists, because a folder grant can be revoked between
 * sessions and a fresh install has none at all.
 */
const SHARE_SENTINEL = 'share:';

async function writeBytes(dest: DestRef, bytes: Uint8Array): Promise<DestRef> {
  if (!dest.id.startsWith(SHARE_SENTINEL)) {
    try {
      // Through the app's own plugin: Filesystem.writeFile cannot write a
      // content:// URI, which is the only kind of destination Android gives out.
      await DocumentStore.writeDocument({ uri: dest.id, data: toBase64(bytes) });
      return dest;
    } catch {
      // The grant may have lapsed since it was taken. Fall through to the sheet
      // rather than losing the user's work.
    }
  }

  // Staged in the app's own cache first: the sheet shares a file, so one has to
  // exist before it can be offered.
  const cached = await Filesystem.writeFile({
    path: dest.name,
    data: toBase64(bytes),
    directory: Directory.Cache,
  });
  await FileSharer.share({
    filename: dest.name,
    contentType: 'application/pdf',
    base64Data: toBase64(bytes),
  }).catch(() => { /* the user dismissing the sheet is not a failure */ });
  return { id: cached.uri, name: dest.name };
}

/* ------------------------------------------------------- op adaptation */

function toDocInfo(info: PdfInfo, ref: DocRef): DocInfo {
  return {
    // The handle the app knows, not the MEMFS name qpdf was given.
    ref,
    pageCount: info.pageCount,
    sizeBytes: info.sizeBytes,
    hasOutlines: info.hasOutlines,
    hasAcroForm: info.hasAcroForm,
    isEncrypted: info.isEncrypted,
    outline: info.outline,
  };
}

/** Run an operation that produces one file, then deliver it to `output`. */
async function produce(
  work: (outName: string) => Promise<OpResult>,
  output: DestRef,
  hint: string,
): Promise<OpOutcome> {
  const outName = stageOut(hint);
  try {
    const res = await adapt(work(outName));
    const written = await writeBytes(output, await wasmHost.read(outName));
    return { output: written, warnings: res.warnings, bookmarks: res.bookmarks };
  } finally {
    await wasmHost.remove(outName);
  }
}

/** `OpError` is the shared layer's; the renderer already understands `IpcError`. */
async function adapt<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof OpError) throw new IpcError(err.messageKey, err.detail);
    throw err;
  }
}

/* ------------------------------------------------------------- platform */

export const capacitorPlatform: Platform = {
  capabilities: {
    // Android has no "show this file in its folder"; the share sheet is the
    // nearest thing, and the toast offers that instead.
    revealInFolder: false,
    openExternal: true,
    camera: true,
  },

  // A WebView drop is not a thing on Android, but the web build reaches this.
  filesToRefs: () => [],

  openPdfs: async (multi) => {
    const { files } = await FilePicker.pickFiles({
      types: ['application/pdf'],
      limit: multi ? 0 : 1,
    });
    return files.map((f) => ({ id: f.path ?? f.name, name: f.name }));
  },

  openImages: async () => {
    const { files } = await FilePicker.pickImages({});
    return files.map((f) => ({ id: f.path ?? f.name, name: f.name }));
  },

  chooseFolder: async () => {
    const { path } = await FilePicker.pickDirectory();
    return path ? { id: path, name: path.split(/[\/%]/).pop() ?? path } : null;
  },

  /**
   * The system Save-as dialog: the user picks the folder and the name, in any
   * provider they have. It creates the file empty and hands back a URI, which
   * is exactly the shape `saveAs` then `writeFile` already assumed.
   */
  saveAs: async (suggestedName) => {
    try {
      const res = await DocumentStore.createDocument({
        suggestedName, mimeType: 'application/pdf',
      });
      if (res.cancelled || !res.uri) return null;
      return { id: res.uri, name: res.name ?? suggestedName };
    } catch {
      // No dialog available: fall back to the sheet rather than refusing to save.
      return { id: `${SHARE_SENTINEL}${suggestedName}`, name: suggestedName };
    }
  },

  siblingWithExtension: (d, ext) => {
    // Only meaningful for a real location. Under the share sentinel the name is
    // all there is, which is enough to offer a second file to the sheet.
    const base = d.name.replace(/\.pdf$/i, '');
    if (base === d.name) return null;
    const name = `${base}.${ext}`;
    return d.id.startsWith(SHARE_SENTINEL)
      ? { id: `${SHARE_SENTINEL}${name}`, name }
      : { id: d.id.replace(/\.pdf$/i, `.${ext}`), name };
  },

  readFile: (ref) => readBytes(ref),
  writeFile: (dest, bytes) => writeBytes(dest, bytes),

  /**
   * Always false.
   *
   * The desktop checks this to warn before a split overwrites existing files.
   * A granted tree URI cannot be probed by name -- and it does not need to be:
   * `DocumentsContract.createDocument` never overwrites, it disambiguates, so a
   * clash becomes "report (1).pdf" rather than a lost file.
   */
  existsIn: async () => false,

  inspect: async (ref) => {
    const name = await stageIn(ref);
    return toDocInfo(await adapt(ops.inspect(name)), ref);
  },

  editPages: async (input, output, opts) => {
    const inName = await stageIn(input);
    return produce((outName) => ops.editPages({
      input: inName, output: outName,
      keep: opts.keep, rotations: opts.rotations, reordered: opts.reordered,
    }), output, 'edit.pdf');
  },

  merge: async (inputs, output, generateBookmarks) => {
    const names: string[] = [];
    for (const ref of inputs) names.push(await stageIn(ref));
    return produce((outName) => ops.merge({
      inputs: names, output: outName, generateBookmarks,
    }), output, 'merge.pdf');
  },

  split: async (input, outputDir, parts: SplitPart[]): Promise<SplitOutcome> => {
    const inName = await stageIn(input);
    // qpdf writes every piece into MEMFS first, then each is delivered in turn:
    // a share sheet per file is the only way Android offers to place several.
    const res = await adapt(ops.split({ input: inName, outputDir: '/split', parts }));
    const outputs: DestRef[] = [];
    try {
      for (const name of res.outputs) {
        const leaf = name.split('/').pop() ?? name;
        // One save dialog per piece would be intolerable, so each file is
        // created inside the folder the user granted once.
        let dest: DestRef;
        try {
          const made = await DocumentStore.createInTree({
            treeUri: outputDir.id, name: leaf, mimeType: 'application/pdf',
          });
          dest = { id: made.uri, name: made.name };
        } catch {
          dest = { id: `${SHARE_SENTINEL}${leaf}`, name: leaf };
        }
        outputs.push(await writeBytes(dest, await wasmHost.read(name)));
      }
    } finally {
      for (const name of res.outputs) await wasmHost.remove(name);
    }
    return { outputs, warnings: res.warnings };
  },

  compress: async (input, output): Promise<CompressOutcome> => {
    const inName = await stageIn(input);
    const outName = stageOut('compress.pdf');
    try {
      const res = await adapt(ops.compress({ input: inName, output: outName }));
      const written = await writeBytes(output, await wasmHost.read(outName));
      return {
        output: written,
        warnings: res.warnings,
        beforeBytes: res.beforeBytes,
        afterBytes: res.afterBytes,
      };
    } finally {
      await wasmHost.remove(outName);
    }
  },

  /**
   * Edge detection, perspective correction, multi-page capture and the crop UI
   * all come from the OS -- ML Kit on Android, VisionKit on iOS. The result is
   * a file per page, read back as bytes here so nothing above this line learns
   * about the scanner's temporary files.
   */
  scanDocument: async (maxPages) => {
    const res = await DocumentScanner.scanDocument({
      responseType: ResponseType.ImageFilePath,
      maxNumDocuments: maxPages,
      letUserAdjustCrop: true,
    });
    // Backing out is an ordinary outcome, not a failure.
    if (res.status !== 'success' || !res.scannedImages?.length) return [];

    const pages: Uint8Array[] = [];
    for (const path of res.scannedImages) {
      pages.push(await readBytes({ id: path, name: 'scan.jpg' }));
    }
    return pages;
  },

  revealInFolder: async () => { /* capability is false; nothing calls this */ },

  openFile: async (ref) => {
    await FileSharer.share({
      filename: ref.name,
      contentType: 'application/pdf',
      base64Data: toBase64(await readBytes({ id: ref.id, name: ref.name })),
    }).catch(() => { /* dismissed */ });
  },

  versions: async () => ({
    qpdf: await wasmQpdfVersion(),
    platform: Capacitor.getPlatform(),
  }),
};
