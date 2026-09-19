/**
 * The Electron host for the shared PDF operations.
 *
 * The operations themselves live in `shared/pdfOps.ts` so the mobile build can
 * run the identical code over qpdf-wasm. What is left here is the host: real
 * paths, a real temp directory, and the native spawner.
 *
 * Note what this host does NOT do: it never copies an input anywhere. A name is
 * a path, so qpdf reads the user's file exactly where it lies, the same way it
 * always has.
 */
import { runQpdf, AppError } from './qpdf.js';
import { makePdfOps, OpError, type QpdfHost } from '../shared/pdfOps.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Where staged files go.
 *
 * Overridable so tests can isolate themselves: they run in parallel and would
 * otherwise share one directory, where each sees the others' staging and reports
 * a leak that is not there.
 */
function tempDir(): string {
  return process.env.PDF_TOOLS_TMPDIR || os.tmpdir();
}

const nodeHost: QpdfHost = {
  run: (args) => runQpdf(args),
  temp: (tag) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return path.join(tempDir(), `pdf-tools-${tag}-${unique}.pdf`);
  },
  read: (name) => fs.readFile(name),
  write: async (name, bytes) => { await fs.writeFile(name, bytes); },
  copy: (from, to) => fs.copyFile(from, to),
  remove: (name) => fs.rm(name, { force: true }),
  size: async (name) => (await fs.stat(name)).size,
  join: (dir, name) => path.join(dir, name),
  baseName: (name) => path.basename(name),
};

const ops = makePdfOps(nodeHost);

/**
 * `OpError` carries a translation key, exactly as `AppError` does; it exists
 * separately only so `shared/` does not have to import from `electron/`.
 * Rethrowing keeps `main.ts`'s error envelope working unchanged.
 */
async function adapt<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof OpError) throw new AppError(err.messageKey, err.detail);
    throw err;
  }
}

export const inspect: typeof ops.inspect = (file) => adapt(ops.inspect(file));
export const editPages: typeof ops.editPages = (req) => adapt(ops.editPages(req));
export const merge: typeof ops.merge = (req) => adapt(ops.merge(req));
export const split: typeof ops.split = (req) => adapt(ops.split(req));
export const compress: typeof ops.compress = (req) => adapt(ops.compress(req));
