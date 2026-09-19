import type { StringKey } from '../i18n/strings.js';
import type { Vars } from '../i18n/t.js';

/**
 * An error whose message is a translation key rather than prose.
 *
 * Library code cannot know what language the interface is in, so it names the
 * problem and lets the UI phrase it -- the same rule the main process follows
 * (see `AppError` in electron/qpdf.ts, which crosses the IPC boundary instead).
 */
export class UserError extends Error {
  constructor(readonly messageKey: StringKey, readonly vars?: Vars) {
    super(messageKey);
    this.name = 'UserError';
  }
}

/**
 * A failure that crossed the host boundary, carrying the translation key so the
 * UI can localise it while keeping the raw text for anything unrecognised.
 *
 * It lives here rather than beside the platform adapter that throws it because
 * `errorText` and the adapter would otherwise import each other.
 */
export class IpcError extends Error {
  constructor(readonly messageKey: string | undefined, readonly detail: string | undefined) {
    super(messageKey ?? detail ?? 'error.qpdf');
    this.name = 'IpcError';
  }
}

/** Thrown when an image cannot be decoded; distinguished so callers can say so. */
export class UnsupportedImageError extends UserError {
  constructor(messageKey: StringKey, vars?: Vars) {
    super(messageKey, vars);
    this.name = 'UnsupportedImageError';
  }
}

/** Thrown by the page-range parser; the range box shows it inline. */
export class RangeParseError extends UserError {
  constructor(messageKey: StringKey, vars?: Vars) {
    super(messageKey, vars);
    this.name = 'RangeParseError';
  }
}
