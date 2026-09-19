import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// pdfjs-dist v4+ is ESM-only and needs its worker wired explicitly under Vite.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Pixels to render per CSS pixel.
 *
 * Capped at 3 rather than 2: a modern phone is 3x, and a reader you hold close
 * to your face shows soft text at 2 in a way a 130px thumbnail never did. The
 * cap exists at all because the cost is quadratic -- 4x is 78% more pixels than
 * 3x for a difference nobody can see.
 */
function deviceScale(): number {
  return Math.min(window.devicePixelRatio || 1, 3);
}

/**
 * Open a PDF for rendering. The bytes come over IPC from the main process --
 * the renderer has no filesystem access of its own.
 *
 * pdf.js takes ownership of (and detaches) the buffer it is given, so each
 * document gets its own copy.
 */
export async function openDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: bytes.slice(),
    // Bundled locally so the app renders CJK / non-Latin encodings and the
    // standard 14 fonts correctly with no network access.
    cMapUrl: './cmaps/',
    cMapPacked: true,
    standardFontDataUrl: './standard_fonts/',
  }).promise;
}

/** Render one page into a canvas sized to fit `maxWidth` CSS pixels. */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNum: number,
  maxWidth: number,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement | null> {
  const page = await doc.getPage(pageNum);
  if (signal?.aborted) return null;

  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (maxWidth / base.width) * deviceScale() });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.round(viewport.width / deviceScale())}px`;
  canvas.style.height = `${Math.round(viewport.height / deviceScale())}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Aborting must actually stop the work, not just discard the result:
  // scrolling a 500-page document otherwise keeps rasterising pages that have
  // already left the viewport.
  const task = page.render({ canvas, canvasContext: ctx, viewport });
  const onAbort = () => task.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await task.promise;
  } catch (err) {
    // A cancelled render is the expected outcome of scrolling away, not a fault.
    if (signal?.aborted) return null;
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  return signal?.aborted ? null : canvas;
}

/**
 * Release a document and its worker transport.
 * In pdfjs v6 `destroy()` lives on the loading task, not the document proxy.
 */
export async function closeDocument(doc: PDFDocumentProxy | null | undefined): Promise<void> {
  try { await doc?.loadingTask.destroy(); } catch { /* already gone */ }
}

/**
 * Rasterise one page at an explicit scale and return it as an `ImageBitmap`.
 *
 * The reader needs a scale rather than a target width (zoom is the user's, not
 * the layout's), and a bitmap rather than a canvas so the result can be cached
 * and evicted independently of whatever is currently mounted -- see
 * `src/lib/renderCache.ts`.
 *
 * `scale` is in CSS pixels per PDF point; device resolution is applied here.
 */
export async function renderPageBitmap(
  doc: PDFDocumentProxy,
  pageNum: number,
  scale: number,
  rotation: number,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> {
  const page = await doc.getPage(pageNum);
  if (signal?.aborted) return null;

  const viewport = page.getViewport({
    scale: scale * deviceScale(),
    // Added to the page's own /Rotate rather than replacing it, which is what
    // makes "rotate the view" compose with a page that is already landscape.
    rotation: (page.rotate + rotation) % 360,
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const task = page.render({ canvas, canvasContext: ctx, viewport });
  const onAbort = () => task.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await task.promise;
  } catch {
    // A cancelled render is the expected outcome of scrolling away.
    return null;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // The intermediate canvas is scratch; the bitmap below owns the pixels.
  }
  if (signal?.aborted) return null;

  const bitmap = await createImageBitmap(canvas);
  // A full page at 3x is ~20 MB. Releasing the scratch canvas immediately keeps
  // only one copy alive while scrolling.
  canvas.width = 0;
  canvas.height = 0;
  return bitmap;
}

/** Page size in CSS pixels at a given scale, including the view rotation. */
export async function pageSize(
  doc: PDFDocumentProxy, pageNum: number, rotation: number,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNum);
  const v = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  return { width: v.width, height: v.height };
}

/** A stable identity for a document, for cache keys. */
export function documentId(doc: PDFDocumentProxy): string {
  return doc.fingerprints?.[0] ?? String(doc.numPages);
}
