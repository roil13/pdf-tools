import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { registerAppScheme, serveDirectory, APP_ORIGIN } from './protocol.js';
import { runQpdf, QpdfError, AppError } from './qpdf.js';
import { inspect, editPages, merge, split, compress } from './operations.js';
import type {
  EditPagesRequest, MergeRequest, SplitRequest, CompressRequest,
} from '../shared/types.js';

// esbuild emits CommonJS for the Electron side, so __dirname is available
// (import.meta.url would be empty there).
declare const __dirname: string;
const DIRNAME = __dirname;
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9',
    title: 'PDF Toolkit',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(DIRNAME, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win?.show());

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`);
  }

  // Never let the app navigate away from itself or open windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Must run before the app is ready.
registerAppScheme();

app.whenReady().then(() => {
  serveDirectory(path.join(DIRNAME, '..', 'dist'));
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

/** Wrap a handler so thrown errors reach the renderer as readable messages. */
function handle<T>(channel: string, fn: (...args: never[]) => Promise<T>): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true as const, value: await fn(...(args as never[])) };
    } catch (err) {
      // Send a translation key rather than a message: the renderer owns
      // language, and `detail` preserves the original text for diagnosis.
      // Narrowed by type rather than by shape, so an unexpected throw is
      // reported as-is instead of silently producing an undefined key.
      if (err instanceof QpdfError) {
        return { ok: false as const, key: err.messageKey, detail: err.detail };
      }
      if (err instanceof AppError) {
        return { ok: false as const, key: err.messageKey, detail: err.detail };
      }
      return {
        ok: false as const,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

const PDF_FILTER = { name: 'PDF documents', extensions: ['pdf'] };
const IMAGE_FILTER = {
  name: 'Images',
  extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff', 'heic', 'heif'],
};

function registerHandlers(): void {
  handle('dialog:openPdfs', async (multi: boolean) => {
    const r = await dialog.showOpenDialog(win!, {
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [PDF_FILTER],
    });
    return r.canceled ? [] : r.filePaths;
  });

  handle('dialog:openImages', async () => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [IMAGE_FILTER],
    });
    return r.canceled ? [] : r.filePaths;
  });

  handle('dialog:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('dialog:saveAs', async (suggestedName: string) => {
    // showSaveDialog already raises Windows' native "replace?" prompt, which is
    // why the app adds no confirmation modal of its own.
    const r = await dialog.showSaveDialog(win!, {
      defaultPath: suggestedName,
      filters: [PDF_FILTER],
    });
    return r.canceled ? null : r.filePath;
  });

  handle('fs:readFile', async (p: string) => {
    const buf = await fs.readFile(p);
    return new Uint8Array(buf);
  });
  /**
   * Write via a sibling temp file and rename into place.
   *
   * The qpdf-backed operations already stage, but the two that build a document
   * in the renderer (Make Searchable, Images to PDF) used to write straight to
   * the destination, so a failure part-way -- a full disk, most plausibly --
   * left a truncated PDF at the path the user chose. After OCR that is minutes
   * of work replaced by a broken file.
   *
   * The temp file is a sibling rather than in the system temp directory, so the
   * rename stays on one volume and is therefore atomic.
   */
  handle('fs:writeFile', async (p: string, bytes: Uint8Array) => {
    const staged = path.join(path.dirname(p), `.${path.basename(p)}.part`);
    try {
      await fs.writeFile(staged, Buffer.from(bytes));
      await fs.rename(staged, p);
      return p;
    } catch (err) {
      await fs.rm(staged, { force: true });
      throw err;
    }
  });
  // Takes the directory and name separately: the renderer must not build paths,
  // or the existence check and the write can disagree on the separator.
  handle('fs:existsIn', async (dir: string, name: string) => {
    try { await fs.access(path.join(dir, name)); return true; } catch { return false; }
  });

  handle('pdf:inspect', (p: string) => inspect(p));
  handle('pdf:editPages', (r: EditPagesRequest) => editPages(r));
  handle('pdf:merge', (r: MergeRequest) => merge(r));
  handle('pdf:split', (r: SplitRequest) => split(r));
  handle('pdf:compress', (r: CompressRequest) => compress(r));

  handle('shell:reveal', async (p: string) => { shell.showItemInFolder(p); });

  /**
   * Opens a file in whatever the OS associates with it.
   *
   * Restricted to the kinds this app produces. The renderer only ever passes a
   * file it has just written, so nothing is lost -- but `shell.openPath` will
   * happily launch an executable, and narrowing the handler means a renderer
   * flaw cannot turn this channel into one.
   */
  handle('shell:open', async (p: string) => {
    if (!/\.(pdf|txt)$/i.test(p)) throw new AppError('error.qpdf', `refused to open ${p}`);
    await shell.openPath(p);
  });

  handle('app:versions', async () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    qpdf: (await runQpdf(['--version'])).stdout.split('\n')[0].trim(),
  }));
}
