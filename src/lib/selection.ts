/**
 * Page selection in a grid that can be rearranged.
 *
 * The subtlety: once pages have been reordered, a page's NUMBER and its
 * POSITION in the grid are different things. Shift-select has to span what the
 * user can see between the two tiles, so it works on positions; everything the
 * result feeds into (qpdf, rotation remapping) works on page numbers.
 */

export interface ToggleArgs {
  /** Source page numbers, in the order the grid is displaying them. */
  pages: number[];
  selected: ReadonlySet<number>;
  /** The page whose tile was clicked. */
  pageNum: number;
  shift: boolean;
  /** The page clicked previously, or null if there isn't one. */
  anchor: number | null;
}

export function toggleSelection({ pages, selected, pageNum, shift, anchor }: ToggleArgs): Set<number> {
  const next = new Set(selected);
  const from = anchor === null ? -1 : pages.indexOf(anchor);
  const to = pages.indexOf(pageNum);

  if (shift && from >= 0 && to >= 0) {
    // Whether the run is added or removed follows the tile that was clicked,
    // so shift-clicking a selected page clears the run rather than re-adding it.
    const turningOn = !selected.has(pageNum);
    const [lo, hi] = from < to ? [from, to] : [to, from];
    for (let i = lo; i <= hi; i++) {
      if (turningOn) next.add(pages[i]); else next.delete(pages[i]);
    }
    return next;
  }

  if (next.has(pageNum)) next.delete(pageNum); else next.add(pageNum);
  return next;
}

/** True when the grid is no longer in natural 1..n order. */
export function isReordered(pages: number[]): boolean {
  return pages.some((p, i) => p !== i + 1);
}

/**
 * What the selection means.
 *
 * `all` exists because rearranging or rotating is a whole-document edit that
 * has nothing to do with picking pages out. Without it, reordering a file and
 * saving it would mean selecting every page first, which reads as "extract
 * everything" and is a step that shouldn't be needed.
 */
export type SelectionMode = 'all' | 'keep' | 'remove';

/**
 * The pages that end up in the output, in output order. Order comes from the
 * grid rather than from sorting: qpdf honours "8,1-7" as a sequence, so
 * rearranging and selecting are one operation.
 */
export function outputPages(
  pages: number[],
  selected: ReadonlySet<number>,
  mode: SelectionMode,
): number[] {
  if (mode === 'all') return [...pages];
  return pages.filter((p) => (mode === 'keep' ? selected.has(p) : !selected.has(p)));
}

/**
 * Keep the mode in step with whether anything is selected.
 *
 * Selecting a page is a clear signal that the user wants to act on a subset, and
 * clearing the selection is an equally clear signal that they don't -- leaving a
 * stale `keep` mode behind would show "select at least one page" at someone who
 * only wanted to rearrange.
 */
export function nextMode(mode: SelectionMode, selectionSize: number): SelectionMode {
  if (selectionSize === 0) return 'all';
  return mode === 'all' ? 'keep' : mode;
}
