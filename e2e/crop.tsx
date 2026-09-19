/**
 * Mounts the real Cropper in a real renderer and drives it with pointer events.
 *
 * The rectangle arithmetic is unit tested in `test/cropRect.test.ts`. What that
 * cannot cover is the half that only exists in a browser: pointer capture, the
 * mapping from a pointer position to a fraction of the image box, and whether a
 * handle is actually reachable. All three are what makes cropping work or not on
 * a touchscreen, and none of them are visible to a unit test.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Cropper } from '../src/components/Cropper.js';
import { LocaleProvider } from '../src/i18n/LocaleProvider.js';
import { FULL_CROP, type CropRect } from '../src/lib/cropRect.js';
import '../src/styles.css';

declare global {
  interface Window {
    e2eCrop?: unknown;
    /** The rectangle the cropper currently shows. */
    cropRect?: CropRect;
    /** What Apply handed back, once. */
    cropApplied?: CropRect | null;
  }
}

/** A 400x300 image, drawn rather than fetched so the harness needs no assets. */
function testImageUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ccd5e0';
  ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = '#334';
  ctx.fillRect(40, 30, 320, 240);
  return canvas.toDataURL('image/png');
}

function Harness() {
  const [applied, setApplied] = useState<CropRect | null>(null);
  window.cropApplied = applied;
  return (
    <Cropper
      url={testImageUrl()}
      initial={FULL_CROP}
      turns={0}
      onCancel={() => { window.cropApplied = null; }}
      onApply={(rect) => { setApplied(rect); window.cropApplied = rect; }}
    />
  );
}

try {
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider><Harness /></LocaleProvider>,
  );
  window.e2eCrop = { mounted: true };
} catch (err) {
  window.e2eCrop = { mounted: false, error: String(err) };
}

window.addEventListener('error', (e) => {
  window.e2eCrop = { mounted: false, error: String(e.message) };
});
window.addEventListener('unhandledrejection', (e) => {
  window.e2eCrop = { mounted: false, error: `unhandled rejection: ${String(e.reason)}` };
});
