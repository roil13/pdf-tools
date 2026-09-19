/**
 * Turn arbitrary text (bookmark titles, mostly) into a safe Windows filename.
 * Windows is stricter than POSIX: a set of reserved punctuation, control
 * characters, a list of reserved device names that fail even WITH an extension,
 * and no trailing dots or spaces (Explorer silently strips those, which breaks
 * any later "did I actually write this file?" check).
 */

/** Punctuation Windows forbids in a filename. Spaces and hyphens are legal and kept. */
const ILLEGAL_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const MAX_STEM = 100;

/** Replace forbidden punctuation and control characters with spaces. */
function stripIllegal(input: string): string {
  let out = '';
  for (const ch of input) {
    out += ILLEGAL_CHARS.has(ch) || ch.codePointAt(0)! < 32 ? ' ' : ch;
  }
  return out;
}

export function safeName(raw: string, fallback = 'part'): string {
  let s = stripIllegal(raw ?? '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/, ''); // no trailing dots or spaces
  if (s.length > MAX_STEM) s = s.slice(0, MAX_STEM).trim().replace(/[. ]+$/, '');
  if (!s) return fallback;
  if (RESERVED.test(s)) return `_${s}`; // CON.pdf is still invalid on Windows
  return s;
}

/**
 * Make every name in a list unique by appending " (2)", " (3)", ... to repeats.
 * Comparison is case-insensitive, because Windows filesystems are.
 */
export function uniquify(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n === 0 ? name : `${name} (${n + 1})`;
  });
}

/** Zero-pad to the width needed for `total`, so files sort correctly in Explorer. */
export function padIndex(index: number, total: number): string {
  return String(index).padStart(String(total).length, '0');
}
