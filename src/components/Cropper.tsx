import { useCallback, useRef, useState } from 'react';
import {
  clampRect, dragRect, rectFromCorners, FULL_CROP,
  type CropRect, type CropHandle,
} from '../lib/cropRect.js';
import { useT } from '../i18n/LocaleProvider.js';

interface CropperProps {
  /** Object URL of the image being cropped. */
  url: string;
  /** Where the crop starts, usually the page's current one. */
  initial: CropRect;
  /** Quarter turns the preview is shown at, so the crop matches what is seen. */
  turns: number;
  onCancel(): void;
  onApply(rect: CropRect): void;
}

/** Handles, in the order they are drawn. Corners last so they take the hit. */
const HANDLES: CropHandle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

/**
 * Drag a rectangle over an image to crop it.
 *
 * All the arithmetic lives in `src/lib/cropRect.ts` and is tested there; what is
 * here is pointer handling. Two things that matter on a phone:
 *
 * - Pointer capture, so a drag that leaves the image still tracks. Without it a
 *   rectangle sticks the moment your thumb crosses the edge, which is exactly
 *   when you are trying to crop to the edge.
 * - Deltas measured from where the drag STARTED, not since the last event, so a
 *   drag that runs past a limit and comes back lands where the pointer is rather
 *   than somewhere it drifted to.
 */
export function Cropper({ url, initial, turns, onCancel, onApply }: CropperProps) {
  const t = useT();
  const [rect, setRect] = useState<CropRect>(initial);
  const surface = useRef<HTMLDivElement | null>(null);
  /** Nothing is being dragged when this is null. */
  const drag = useRef<{ handle: CropHandle; startRect: CropRect; ox: number; oy: number } | null>(null);

  /** Pointer position as a fraction of the image box. */
  const fraction = useCallback((e: React.PointerEvent) => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return { x: 0, y: 0 };
    return {
      x: (e.clientX - box.left) / box.width,
      y: (e.clientY - box.top) / box.height,
    };
  }, []);

  const begin = useCallback((handle: CropHandle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const at = fraction(e);
    drag.current = { handle, startRect: rect, ox: at.x, oy: at.y };
  }, [fraction, rect]);

  /** Dragging on the backdrop draws a fresh rectangle from that corner. */
  const beginFresh = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const at = fraction(e);
    // The seed is deliberately zero-sized and UNCLAMPED. Clamping it here would
    // fold the minimum size into the drag's origin, so the finished rectangle
    // came out one minimum bigger than the gesture that drew it -- a crop
    // slightly larger than the one you dragged. The result is clamped instead.
    drag.current = { handle: 'se', startRect: { x: at.x, y: at.y, width: 0, height: 0 }, ox: at.x, oy: at.y };
    setRect(clampRect(rectFromCorners(at.x, at.y, at.x, at.y)));
  }, [fraction]);

  const move = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const at = fraction(e);
    setRect(dragRect(d.startRect, d.handle, at.x - d.ox, at.y - d.oy));
  }, [fraction]);

  const end = useCallback(() => { drag.current = null; }, []);

  const pct = (n: number) => `${n * 100}%`;

  return (
    <div className="cropper" role="dialog" aria-modal="true" aria-label={t('crop.title')}>
      <div className="cropper__frame">
        <div
          ref={surface}
          className="cropper__surface"
          onPointerDown={beginFresh}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <img
            src={url}
            alt=""
            className="cropper__image"
            style={turns ? { transform: `rotate(${turns * 90}deg)` } : undefined}
            draggable={false}
          />

          {/* Four bands rather than one box with a hole, so the dimming is a
              plain rectangle each time and needs no mask. */}
          <div className="cropper__shade" style={{ top: 0, left: 0, right: 0, height: pct(rect.y) }} />
          <div className="cropper__shade" style={{ bottom: 0, left: 0, right: 0, height: pct(1 - rect.y - rect.height) }} />
          <div className="cropper__shade" style={{ top: pct(rect.y), left: 0, width: pct(rect.x), height: pct(rect.height) }} />
          <div className="cropper__shade" style={{ top: pct(rect.y), right: 0, width: pct(1 - rect.x - rect.width), height: pct(rect.height) }} />

          <div
            className="cropper__box"
            style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.width), height: pct(rect.height) }}
            onPointerDown={begin('move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            {HANDLES.map((h) => (
              <span
                key={h}
                className={`cropper__handle cropper__handle--${h}`}
                onPointerDown={begin(h)}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="cropper__bar">
        <button className="btn btn--ghost" onClick={() => setRect(FULL_CROP)}>{t('crop.reset')}</button>
        <div className="cropper__gap" />
        <button className="btn btn--ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn--primary" onClick={() => onApply(rect)}>{t('crop.apply')}</button>
      </div>
    </div>
  );
}
