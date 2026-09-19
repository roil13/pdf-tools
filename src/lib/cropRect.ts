/**
 * Crop rectangles, in normalised coordinates.
 *
 * A crop is stored as fractions of the image (0..1) rather than pixels, so it
 * survives the preview being any size and means the same thing on a phone and a
 * desktop. Everything here is pure: dragging a handle is fiddly to get right and
 * miserable to debug through a browser, so the arithmetic is separated from the
 * pointer handling and tested on its own.
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** Which part of the rectangle a drag is moving. */
export type CropHandle =
  | 'move'
  | 'n' | 's' | 'e' | 'w'
  | 'nw' | 'ne' | 'sw' | 'se';

/**
 * Smallest crop we allow, as a fraction of each side.
 *
 * Not zero: a rectangle dragged to nothing is impossible to grab again, and a
 * crop that keeps two percent of a page is never what someone meant.
 */
const MIN_SIDE = 0.05;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A rectangle from any two corners, normalised so width and height are positive. */
export function rectFromCorners(ax: number, ay: number, bx: number, by: number): CropRect {
  const x1 = clamp01(Math.min(ax, bx));
  const y1 = clamp01(Math.min(ay, by));
  const x2 = clamp01(Math.max(ax, bx));
  const y2 = clamp01(Math.max(ay, by));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** Whether a rectangle is the whole image, i.e. not really a crop at all. */
export function isFullCrop(rect: CropRect): boolean {
  return rect.x <= 0 && rect.y <= 0 && rect.width >= 1 && rect.height >= 1;
}

/** Keep a rectangle inside the image and no smaller than the minimum. */
export function clampRect(rect: CropRect): CropRect {
  const width = Math.min(1, Math.max(MIN_SIDE, rect.width));
  const height = Math.min(1, Math.max(MIN_SIDE, rect.height));
  return {
    width,
    height,
    x: Math.min(1 - width, Math.max(0, rect.x)),
    y: Math.min(1 - height, Math.max(0, rect.y)),
  };
}

/**
 * Apply a drag to a rectangle.
 *
 * `dx`/`dy` are the movement so far as fractions of the image, measured from
 * where the drag started -- not since the last event. Deltas from the start make
 * the result depend only on where the pointer is now, so a drag that outruns the
 * edge and comes back does not accumulate error.
 *
 * Moving translates. Every other handle moves one or two edges, and an edge
 * dragged past its opposite flips rather than inverting the rectangle, which is
 * what `rectFromCorners` is for.
 */
export function dragRect(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
): CropRect {
  if (handle === 'move') {
    return clampRect({ ...start, x: start.x + dx, y: start.y + dy });
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (handle.includes('w')) left = start.x + dx;
  if (handle.includes('e')) right = start.x + start.width + dx;
  if (handle.includes('n')) top = start.y + dy;
  if (handle.includes('s')) bottom = start.y + start.height + dy;

  return clampRect(rectFromCorners(left, top, right, bottom));
}

/** The crop in image pixels, rounded to whole pixels and at least one of each. */
export function toPixels(
  rect: CropRect,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; width: number; height: number } {
  // The origin is pulled back far enough to leave room for the minimum size.
  // Rounding it to the very edge first and then forcing a one-pixel width is
  // what puts the crop one pixel outside the image.
  const x = Math.min(imageWidth - 1, Math.max(0, Math.round(rect.x * imageWidth)));
  const y = Math.min(imageHeight - 1, Math.max(0, Math.round(rect.y * imageHeight)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(imageWidth - x, Math.round(rect.width * imageWidth))),
    height: Math.max(1, Math.min(imageHeight - y, Math.round(rect.height * imageHeight))),
  };
}
