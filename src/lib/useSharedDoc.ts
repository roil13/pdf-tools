import { useEffect } from 'react';
import type { DocRef } from '../platform/types.js';

/**
 * Adopt the document the rest of the app has open.
 *
 * Tools are unmounted when you switch away from them (see `App.tsx`), so each
 * one starts empty and asks for a file. That is fine on a desktop with a mouse
 * and a file dialog; on a phone it means walking the storage picker again for a
 * file you opened seconds ago in another tool. `App` therefore holds the current
 * document and every single-document tool adopts it on mount.
 *
 * What this deliberately does NOT do is preserve a tool's own work. Switching
 * away from Edit Pages still discards the selection and the rotations, because
 * those belong to that screen rather than to the document.
 *
 * @param doc        the shared document, or null when nothing is open
 * @param currentId  the id of what this tool already has, if anything
 * @param load       the tool's own loader, which resets its derived state
 */
export function useSharedDoc(
  doc: DocRef | null,
  currentId: string | undefined,
  load: (refs: DocRef[]) => void,
): void {
  useEffect(() => {
    if (doc && doc.id !== currentId) load([doc]);
  }, [doc, currentId, load]);
}
