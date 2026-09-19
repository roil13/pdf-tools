/**
 * The Capacitor platform, loaded on first use.
 *
 * `src/platform/capacitor.ts` pulls in qpdf-wasm and three Capacitor plugins.
 * Importing it eagerly would put all of that in the desktop bundle, where
 * nothing would ever call it, so every method here resolves the real adapter
 * first and then delegates.
 *
 * Two members cannot wait for a promise. Both are static facts about the
 * platform rather than behaviour, so they are answered directly:
 *
 *  - `capabilities` describes Android, which does not change at run time.
 *  - `filesToRefs` turns an OS drag-and-drop into handles, and Android has none.
 */
import type { Platform, DocRef } from './types.js';

const real = () => import('./capacitor.js').then((m) => m.capacitorPlatform);

export const lazyCapacitorPlatform: Platform = {
  capabilities: {
    // No "show in folder" on Android; the share sheet stands in for it.
    revealInFolder: false,
    openExternal: true,
    camera: true,
  },

  filesToRefs: (): DocRef[] => [],

  openPdfs: async (multi) => (await real()).openPdfs(multi),
  openImages: async () => (await real()).openImages(),
  chooseFolder: async () => (await real()).chooseFolder(),
  saveAs: async (name) => (await real()).saveAs(name),

  // Synchronous in the interface because the Electron host can answer from the
  // path alone. Android cannot reach its adapter without awaiting, so it answers
  // from the name -- which is all the share route needs anyway.
  siblingWithExtension: (d, ext) => {
    const base = d.name.replace(/\.pdf$/i, '');
    if (base === d.name) return null;
    const name = `${base}.${ext}`;
    return { id: `share:${name}`, name };
  },

  readFile: async (ref) => (await real()).readFile(ref),
  writeFile: async (dest, bytes) => (await real()).writeFile(dest, bytes),
  existsIn: async (dir, name) => (await real()).existsIn(dir, name),

  inspect: async (ref) => (await real()).inspect(ref),
  editPages: async (input, output, opts) => (await real()).editPages(input, output, opts),
  merge: async (inputs, output, marks) => (await real()).merge(inputs, output, marks),
  split: async (input, dir, parts) => (await real()).split(input, dir, parts),
  compress: async (input, output) => (await real()).compress(input, output),

  scanDocument: async (maxPages) => (await real()).scanDocument(maxPages),

  revealInFolder: async (ref) => (await real()).revealInFolder(ref),
  openFile: async (ref) => (await real()).openFile(ref),
  versions: async () => (await real()).versions(),
};
