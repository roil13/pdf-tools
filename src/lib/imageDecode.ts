/**
 * Decode any image the user drops into something pdf-lib can embed.
 *
 * pdf-lib embeds only PNG and JPEG. Chromium natively decodes PNG, JPEG, WebP,
 * GIF, BMP and AVIF, so those go through a canvas. It decodes neither HEIC nor
 * TIFF, so those get explicit decoders, loaded lazily -- libheif alone is ~4 MB
 * and most people never open a HEIC.
 */

import { UnsupportedImageError, UserError } from './errors.js';

export interface DecodedImage {
  /** Bitmap ready to draw or embed. */
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Set for multi-page TIFFs, so cards can say "page 2 of 5". */
  frame?: { index: number; total: number };
}



const HEIC = /\.(heic|heif)$/i;
const TIFF = /\.(tiff?)$/i;

/**
 * Decode a file into one or more frames. Only multi-page TIFFs return more than
 * one -- dropping a 5-page TIFF and silently getting 1 page would be surprising.
 */
export async function decodeImage(path: string, bytes: Uint8Array): Promise<DecodedImage[]> {
  if (HEIC.test(path)) return decodeHeic(bytes);
  if (TIFF.test(path)) return decodeTiff(bytes);
  return [await decodeNative(bytes, path)];
}

/** Chromium sniffs most formats, but AVIF detection is unreliable without a MIME type. */
function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function decodeNative(bytes: Uint8Array, path: string): Promise<DecodedImage> {
  try {
    const blob = new Blob([bytes as BlobPart], { type: mimeFromPath(path) });
    const bitmap = await createImageBitmap(blob);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    throw new UnsupportedImageError('image.unreadable', { name: path.split(/[\\/]/).pop() ?? path });
  }
}

async function decodeHeic(bytes: Uint8Array): Promise<DecodedImage[]> {
  // wasm-bundle inlines the binary, which is the variant meant for bundlers.
  const mod = await import('libheif-js/wasm-bundle');
  const libheif = (mod as { default?: unknown }).default ?? mod;
  const decoder = new (libheif as { HeifDecoder: new () => HeifDecoder }).HeifDecoder();

  const images = decoder.decode(bytes);
  if (!images.length) throw new UnsupportedImageError('image.heicEmpty');

  const out: DecodedImage[] = [];
  for (const image of images) {
    const width = image.get_width();
    const height = image.get_height();
    const data = new ImageData(width, height);

    await new Promise<void>((resolve, reject) => {
      image.display(data, (result) => (
        result ? resolve() : reject(new UnsupportedImageError('image.heicFailed'))
      ));
    });

    out.push({ bitmap: await createImageBitmap(data), width, height });
  }
  return out;
}

async function decodeTiff(bytes: Uint8Array): Promise<DecodedImage[]> {
  const UTIF = (await import('utif')).default as unknown as UtifApi;

  const ifds = UTIF.decode(bytes);
  if (!ifds.length) throw new UnsupportedImageError('image.tiffEmpty');

  const out: DecodedImage[] = [];
  for (const [i, ifd] of ifds.entries()) {
    UTIF.decodeImage(bytes, ifd, ifds);
    const rgba = UTIF.toRGBA8(ifd);
    const width = ifd.width;
    const height = ifd.height;
    if (!width || !height) continue;

    const data = new ImageData(new Uint8ClampedArray(rgba), width, height);
    out.push({
      bitmap: await createImageBitmap(data),
      width,
      height,
      frame: ifds.length > 1 ? { index: i + 1, total: ifds.length } : undefined,
    });
  }
  if (!out.length) throw new UnsupportedImageError('image.tiffFailed');
  return out;
}

/**
 * Re-encode a bitmap as JPEG bytes for pdf-lib.
 * Everything funnels through here so there is one encoder, not one per format.
 */
export async function toJpegBytes(
  bitmap: ImageBitmap,
  quality = 0.92,
  /** Region to keep, in image pixels. The whole image when absent. */
  box?: { x: number; y: number; width: number; height: number },
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = box ? box.width : bitmap.width;
  canvas.height = box ? box.height : bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UserError('error.noCanvas');

  // JPEG has no alpha, so flatten onto white rather than letting it go black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (box) {
    ctx.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  } else {
    ctx.drawImage(bitmap, 0, 0);
  }

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new UserError('image.encodeFailed');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Small preview element for a card thumbnail. */
export function bitmapToCanvas(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(maxEdge / bitmap.width, maxEdge / bitmap.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/* ------------------------------- module shapes we rely on ---------------- */

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(data: ImageData, cb: (result: ImageData | null) => void): void;
}
interface HeifDecoder {
  decode(bytes: Uint8Array): HeifImage[];
}
interface UtifIfd {
  width: number;
  height: number;
}
interface UtifApi {
  decode(buffer: Uint8Array): UtifIfd[];
  decodeImage(buffer: Uint8Array, ifd: UtifIfd, ifds: UtifIfd[]): void;
  toRGBA8(ifd: UtifIfd): Uint8Array;
}

/**
 * A preview URL for a bitmap, for anything that needs an `<img>` rather than a
 * canvas -- the cropper, which works the same way for a scan and for a picked
 * image and so takes a URL for both.
 *
 * Downscaled: a crop is a pointing task, and the screen is the limit on how
 * accurate it can be, not the source resolution. The caller revokes it.
 */
export async function bitmapToObjectUrl(bitmap: ImageBitmap, maxEdge = 1600): Promise<string> {
  const canvas = bitmapToCanvas(bitmap, maxEdge);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new UserError('image.encodeFailed');
  return URL.createObjectURL(blob);
}
