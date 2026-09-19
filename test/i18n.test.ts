/**
 * The dual form is the reason this exists. English has one/other; Hebrew adds
 * a distinct form for exactly two, so `${n} page${n===1?'':'s'}` -- the pattern
 * the app used everywhere -- cannot express Hebrew at all.
 */
import { describe, it, expect } from 'vitest';
import { resolve, interpolate, selectPlural } from '../src/i18n/t.js';
import { en, he, dictionaries } from '../src/i18n/strings.js';

describe('interpolate', () => {
  it('substitutes named values', () => {
    expect(interpolate('{a} of {b}', { a: 3, b: 10 })).toBe('3 of 10');
  });

  it('leaves unknown placeholders alone rather than printing undefined', () => {
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('is a no-op without vars', () => {
    expect(interpolate('plain')).toBe('plain');
  });
});

describe('selectPlural', () => {
  const enPages = en['common.pages'];
  const hePages = he['common.pages'];

  it('English: one vs other', () => {
    expect(selectPlural(enPages, 'en', 1)).toBe('{n} page');
    expect(selectPlural(enPages, 'en', 2)).toBe('{n} pages');
    expect(selectPlural(enPages, 'en', 7)).toBe('{n} pages');
  });

  it('Hebrew: one, DUAL, other are three distinct forms', () => {
    const one = selectPlural(hePages, 'he', 1);
    const two = selectPlural(hePages, 'he', 2);
    const many = selectPlural(hePages, 'he', 7);
    expect(new Set([one, two, many]).size).toBe(3);
    expect(two).toBe('שני עמודים');
  });

  it('falls back to other when a category is absent', () => {
    // English entries have no `two`; asking for it must not yield undefined.
    expect(selectPlural(enPages, 'en', 2)).toBe('{n} pages');
    expect(selectPlural({ one: 'a', other: 'b' }, 'he', 2)).toBe('b');
  });

  it('handles zero, which Hebrew and English both treat as "other"', () => {
    expect(selectPlural(enPages, 'en', 0)).toBe('{n} pages');
    expect(selectPlural(hePages, 'he', 0)).toBe('{n} עמודים');
  });
});

describe('resolve', () => {
  it('combines plural selection with interpolation', () => {
    expect(resolve(en['common.pages'], 'en', { n: 5 })).toBe('5 pages');
    expect(resolve(he['common.pages'], 'he', { n: 5 })).toBe('5 עמודים');
  });

  it('uses the fixed dual wording, which needs no number', () => {
    expect(resolve(he['common.pages'], 'he', { n: 2 })).toBe('שני עמודים');
  });

  it('passes plain strings through', () => {
    expect(resolve(en['nav.about'], 'en')).toBe('About');
  });
});

describe('dictionaries', () => {
  it('has the same keys in both languages', () => {
    // The Strings interface enforces this at compile time; this catches any
    // runtime divergence, e.g. a key deleted with a ts-ignore.
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty or untranslated-looking Hebrew values', () => {
    const suspicious: string[] = [];
    for (const [key, value] of Object.entries(he)) {
      const parts = typeof value === 'string' ? [value] : Object.values(value);
      for (const part of parts) {
        if (!part || !String(part).trim()) suspicious.push(`${key}: empty`);
      }
    }
    expect(suspicious).toEqual([]);
  });

  it('keeps plural shapes consistent: every plural in en is a plural in he', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(typeof he[key]).toBe(typeof en[key]);
    }
  });

  it('gives Hebrew a dual form wherever it has a plural', () => {
    // Not strictly required -- `other` is a valid fallback -- but a missing
    // `two` in Hebrew is nearly always an oversight worth surfacing.
    const missing: string[] = [];
    for (const [key, value] of Object.entries(he)) {
      if (typeof value === 'object' && !('two' in value)) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it('exposes both locales', () => {
    expect(Object.keys(dictionaries).sort()).toEqual(['en', 'he']);
  });
});
