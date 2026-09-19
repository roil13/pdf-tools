/**
 * Minimal string resolution. No i18n library: with two languages and one
 * dictionary file, `Intl.PluralRules` already provides the only genuinely hard
 * part, and a hand-rolled `t()` lets TypeScript enforce that every key is
 * translated (see strings.ts).
 */

/**
 * A count-dependent string. Hebrew has a DUAL form, so "2 pages" is its own
 * grammatical case, distinct from "3 pages" -- English has no equivalent and
 * simply omits `two`.
 */
export interface Plural {
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Entry = string | Plural;
export type Locale = 'en' | 'he';

export interface Vars {
  /** Drives plural selection as well as being interpolated as {n}. */
  n?: number;
  [key: string]: string | number | undefined;
}

const isPlural = (e: Entry): e is Plural => typeof e === 'object';

// Intl.PluralRules allocates, and these get hit on every render.
const rulesCache = new Map<Locale, Intl.PluralRules>();
function rulesFor(locale: Locale): Intl.PluralRules {
  let r = rulesCache.get(locale);
  if (!r) { r = new Intl.PluralRules(locale); rulesCache.set(locale, r); }
  return r;
}

/** Pick the form for `n`, falling back to `other` for absent categories. */
export function selectPlural(entry: Plural, locale: Locale, n: number): string {
  const category = rulesFor(locale).select(n) as keyof Plural;
  return entry[category] ?? entry.other;
}

/** Replace every {name} with the matching value; unknown ones are left alone. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

export function resolve(entry: Entry, locale: Locale, vars?: Vars): string {
  const template = isPlural(entry)
    ? selectPlural(entry, locale, vars?.n ?? 0)
    : entry;
  return interpolate(template, vars);
}
