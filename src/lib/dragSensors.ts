/**
 * The sensor set every drag-to-reorder screen uses.
 *
 * A single `PointerSensor` with a small distance constraint is right for a mouse
 * and wrong for a finger. Pointer events do not distinguish the two, so a 4px
 * threshold means ANY vertical swipe that starts on a tile becomes a drag rather
 * than a scroll -- the page simply refuses to move, which reads as the app being
 * broken rather than as a gesture conflict.
 *
 * Splitting the sensors is what fixes it. A mouse still picks up after 4px,
 * because that is what makes a click mean "select". A finger has to press and
 * hold, which is the standard Android reorder gesture and leaves ordinary swipes
 * to the scroller. `tolerance` allows the small drift of a real thumb during the
 * hold without cancelling it.
 */
import {
  MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/** Long enough not to fire while scrolling, short enough not to feel stuck. */
const HOLD_MS = 220;
const HOLD_TOLERANCE_PX = 8;

export interface DragSensorOptions {
  /**
   * Overrides for the keyboard sensor. Edit Pages needs one: dnd-kit activates
   * on Space AND Enter by default, and that screen puts selection on Enter.
   */
  keyboardCodes?: { start: string[]; cancel: string[]; end: string[] };
}

export function useDragSensors(options: DragSensorOptions = {}) {
  return useSensors(
    // The distance constraint is what keeps a plain click meaning "select"
    // rather than starting a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: HOLD_MS, tolerance: HOLD_TOLERANCE_PX },
    }),
    useSensor(KeyboardSensor, {
      // Arrow keys need no RTL handling: dnd-kit resolves movement from bounding
      // rects, so "left" is always visually left.
      ...(options.keyboardCodes ? { keyboardCodes: options.keyboardCodes } : {}),
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
}
