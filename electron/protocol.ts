import { protocol, net } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_ORIGIN = 'app://local';

/**
 * Serve the renderer over a custom scheme instead of file://.
 *
 * This is not cosmetic. Chromium blocks fetch() against file:// URLs, and three
 * things depend on fetching relative assets at run time: the tesseract worker,
 * its WASM core and language data, and pdf.js's character maps and standard
 * fonts. Under file:// they would fail only in the packaged build, since the dev
 * server hands them over plain HTTP.
 *
 * Must be called before app is ready.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
}

/**
 * Resolve a request path against the served directory, refusing anything that
 * escapes it.
 *
 * Pure and exported so the containment rule can be tested directly: it is a
 * security boundary, and serving the app exercises only the paths that succeed.
 * Returns null when the request must be refused.
 */
export function resolveWithin(base: string, requestPath: string): string | null {
  let rel: string;
  try {
    // Throws on a malformed percent-escape, which must be a refusal rather than
    // an exception escaping the handler.
    rel = decodeURIComponent(requestPath).replace(/^\/+/, '');
  } catch {
    return null;
  }

  // path.resolve normalises away any "..", so the prefix test below is decisive.
  const target = path.resolve(base, rel || 'index.html');
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

/** Wire the scheme to a directory on disk. Call after app is ready. */
export function serveDirectory(root: string): void {
  const base = path.resolve(root);

  protocol.handle('app', async (request) => {
    const target = resolveWithin(base, new URL(request.url).pathname);
    if (target === null) return new Response('Forbidden', { status: 403 });

    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
