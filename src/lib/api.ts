import { en, type StringKey } from '../i18n/strings.js';
import { UserError, IpcError } from './errors.js';
import type { Vars } from '../i18n/t.js';
import { platform } from '../platform/select.js';
import type { Platform } from '../platform/types.js';

type Translate = (key: StringKey, vars?: Vars) => string;

// Re-exported because it is part of this module's surface as far as callers and
// tests are concerned; it lives in errors.ts to keep the imports acyclic.
export { IpcError };

/**
 * Everything the app can ask of its host.
 *
 * No screen knows which implementation it is talking to; `src/platform/` is the
 * only place that does, and `select.ts` is where it decides.
 */
export const api: Platform = platform;

/** Human-readable byte size. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/**
 * Turn anything thrown during an operation into text for the user.
 *
 * Keyed errors from the main process are translated; anything else falls back
 * to its own message, so an unexpected failure is surfaced rather than hidden
 * behind a generic string.
 */
export function errorText(err: unknown, t: Translate): string {
  // Thrown in the renderer: the key is already typed, and may carry vars.
  if (err instanceof UserError) return t(err.messageKey, err.vars);
  // Crossed the host boundary: the key arrived as a plain string.
  if (err instanceof IpcError) {
    if (isStringKey(err.messageKey)) return t(err.messageKey);
    // Unclassified: show qpdf's own words rather than a generic message.
    return err.detail ?? t('error.qpdf');
  }
  return err instanceof Error ? err.message : String(err);
}

/** Keys arrive from the host as plain strings, so narrow before trusting them. */
function isStringKey(key: string | undefined): key is StringKey {
  return key !== undefined && key in en;
}
