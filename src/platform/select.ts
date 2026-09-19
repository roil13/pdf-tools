/**
 * Which host is this?
 *
 * Decided by asking what is actually present rather than by a build flag.
 * `window.api` exists only because the Electron preload put it there, so its
 * presence IS the question "am I in the desktop app". A build-time constant
 * would have to be threaded through two bundlers and could disagree with
 * reality; this cannot.
 *
 * The check lives here rather than in `src/lib/api.ts` because reaching for
 * `window.api` anywhere else in `src/` is exactly what the `ipc.surface` audit
 * rule forbids -- and rightly so. This file is part of the platform layer, which
 * is the one place allowed to know that name exists.
 */
import { electronPlatform } from './electron.js';
import { lazyCapacitorPlatform } from './lazyCapacitor.js';
import type { Platform } from './types.js';

function detect(): Platform {
  const hasPreloadBridge = typeof window !== 'undefined'
    && (window as unknown as { api?: unknown }).api !== undefined;
  return hasPreloadBridge ? electronPlatform : lazyCapacitorPlatform;
}

let resolved: Platform | null = null;

/**
 * The platform, decided on first USE rather than on import.
 *
 * The distinction is not academic. ES module imports are evaluated before the
 * importing module's own body, so anything that sets `window.api` from a script
 * -- as the e2e harnesses do -- runs after this module is initialised. Deciding
 * at import time would read `window.api` before it exists and quietly choose the
 * mobile adapter on the desktop. The packaged app happens to be safe, because
 * the preload runs before any renderer code, but "happens to be safe" is not the
 * same as safe.
 */
export const platform: Platform = new Proxy({} as Platform, {
  get(_target, prop) {
    resolved ??= detect();
    return resolved[prop as keyof Platform];
  },
});
