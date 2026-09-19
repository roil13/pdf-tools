import { execFile } from 'node:child_process';
import { app } from 'electron';
import path from 'node:path';

/**
 * qpdf exit codes (see qpdf docs):
 *   0 = success
 *   2 = error, no usable output
 *   3 = warnings were issued but output WAS written
 *
 * We deliberately do NOT pass --warning-exit-0: collapsing 3 into 0 would hide
 * the "your PDF was damaged and qpdf repaired it" case, which the user should see.
 */
/** An error identified by a translation key rather than by prose. */
export class AppError extends Error {
  constructor(readonly messageKey: string, readonly detail?: string) {
    super(messageKey);
    this.name = 'AppError';
  }
}

/**
 * Errors carry a translation KEY, not prose.
 *
 * The main process has no idea which language the UI is in -- and should not.
 * The renderer maps `messageKey` through its dictionary, falling back to
 * `detail` (raw qpdf stderr) so an unrecognised failure is never swallowed.
 */
export class QpdfError extends Error {
  constructor(
    readonly messageKey: string,
    readonly exitCode: number,
    readonly detail: string,
  ) {
    super(messageKey);
    this.name = 'QpdfError';
  }
}

export interface QpdfResult {
  stdout: string;
  /** Present when qpdf exited 3: output was written, but with complaints. */
  warnings?: string;
}

let cachedPath: string | null = null;

function qpdfPath(): string {
  if (cachedPath) return cachedPath;
  cachedPath = app.isPackaged
    ? path.join(process.resourcesPath, 'qpdf', 'qpdf.exe')
    : path.join(app.getAppPath(), 'vendor', 'qpdf', 'qpdf.exe');
  return cachedPath;
}

/**
 * Run qpdf. Always execFile with an argv array -- never a shell string, because
 * user paths routinely contain spaces and non-ASCII characters.
 */
export function runQpdf(args: string[]): Promise<QpdfResult> {
  return new Promise((resolve, reject) => {
    execFile(
      qpdfPath(),
      args,
      { maxBuffer: 1024 * 1024 * 512, windowsHide: true },
      (err, stdout, stderr) => {
        const code = (err as NodeJS.ErrnoException & { code?: number })?.code;
        if (!err) return resolve({ stdout });
        if (code === 3) return resolve({ stdout, warnings: stderr.trim() });
        reject(new QpdfError(errorKey(stderr), typeof code === 'number' ? code : 2, stderr.trim()));
      },
    );
  });
}

/**
 * Classify qpdf's terse stderr into a translation key.
 *
 * The main process must not produce user-facing prose, because it has no idea
 * which language the interface is in. The renderer resolves the key, and keeps
 * the raw stderr as `detail` so an unclassified failure still reaches the user.
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
