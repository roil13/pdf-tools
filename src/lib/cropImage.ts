import { UserError } from './errors.js';
import { toPixels, type CropRect } from './cropRect.js';

/**
 * Cut a region out of a JPEG and re-encode it.
 *
 * The scanner path exists precisely to avoid re-encoding, so this runs only for
 * pages the user actually cropped, and only for those. A cropped page is a
 * deliberate trade: the pixels have to be resampled to keep the ones that are
 * left, so they are compressed a second time. An untouched page never goes
 * through here.
 *
 * Quality is high by default for the same reason -- this is the only generation
 * loss a scanned page will suffer, so it should not also be a cheap one.
 */
export async function cropJpeg(
  jpeg: Uint8Array,
  rect: CropRect,
  quality = 0.95,
): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const blob = new Blob([jpeg as BlobPart], { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);

  try {
    const box = toPixels(rect, bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = box.width;
    canvas.height = box.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new UserError('error.noCanvas');
    // JPEG has no alpha, so flatten onto white rather than letting it go black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    // A full-page scan is tens of megabytes of canvas; releasing it here rather
    // than waiting for the collector keeps a multi-page crop affordable.
    canvas.width = 0;
    canvas.height = 0;
    if (!out) throw new UserError('image.encodeFailed');

    return {
      jpeg: new Uint8Array(await out.arrayBuffer()),
      width: box.width,
      height: box.height,
    };
  } finally {
    bitmap.close();
  }
}
