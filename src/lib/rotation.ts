import { formatRanges } from './pageRanges.js';
import type { Rotation } from '../../shared/types.js';

/**
 * qpdf's `--rotate` page ranges refer to OUTPUT numbering, not input.
 * (Verified in docs/spike-findings.md Q6: selecting 6-10 and rotating ":1"
 * rotates the first page of the RESULT, i.e. source page 6.)
 *
 * The UI tracks rotations against SOURCE page numbers, so every rotation has to
 * be remapped through the kept-pages list before it reaches qpdf. Getting this
 * backwards silently rotates the wrong pages -- and would never show up in a
 * test that keeps every page, because there the mapping is the identity.
 *
 * Returns one `--rotate=+<deg>:<ranges>` argument per distinct angle.
 */
export function rotationArgs(keep: number[], rotations: Rotation[]): string[] {
  // source page -> 1-indexed position in the output (first wins if duplicated)
  const outputPos = new Map<number, number>();
  keep.forEach((srcPage, i) => {
    if (!outputPos.has(srcPage)) outputPos.set(srcPage, i + 1);
  });

  const byAngle = new Map<number, number[]>();
  for (const r of rotations) {
    const pos = outputPos.get(r.page);
    if (pos === undefined) continue; // the rotated page isn't being kept
    const list = byAngle.get(r.degrees) ?? [];
    list.push(pos);
    byAngle.set(r.degrees, list);
  }

  return [...byAngle]
    .sort((a, b) => a[0] - b[0])
    .map(([degrees, positions]) =>
      `--rotate=+${degrees}:${formatRanges([...positions].sort((a, b) => a - b))}`);
}

/** Normalise any accumulated turn count into the 90/180/270 qpdf accepts (0 = no-op). */
export function normaliseDegrees(total: number): 0 | 90 | 180 | 270 {
  const d = ((total % 360) + 360) % 360;
  return d as 0 | 90 | 180 | 270;
}
