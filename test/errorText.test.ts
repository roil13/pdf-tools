/**
 * Error rendering is the one place where a mistake is invisible: a wrong key
 * shows a blank or a raw identifier, and only at the moment something has
 * already gone wrong for the user.
 */
import { describe, it, expect } from 'vitest';
import { errorText, IpcError } from '../src/lib/api.js';
import { UserError, RangeParseError, UnsupportedImageError } from '../src/lib/errors.js';
import { en, he, type StringKey } from '../src/i18n/strings.js';
import { resolve, type Locale, type Vars } from '../src/i18n/t.js';

const translator = (locale: Locale) =>
  (key: StringKey, vars?: Vars) => resolve((locale === 'he' ? he : en)[key], locale, vars);

const t = translator('en');
const tHe = translator('he');

describe('errorText', () => {
  it('translates a UserError thrown in the renderer', () => {
    expect(errorText(new UserError('error.encrypted'), t))
      .toBe('This PDF is password-protected, so it can’t be opened.');
  });

  it('interpolates a UserError vars', () => {
    const err = new RangeParseError('range.pointOutside', { page: 99 });
    expect(errorText(err, t)).toBe('Split point 99 is outside this document.');
  });

  it('selects the right plural form from the error vars', () => {
    const one = new RangeParseError('range.outOfRange', { n: 1, page: 5 });
    const many = new RangeParseError('range.outOfRange', { n: 10, page: 11 });
    expect(errorText(one, t)).toContain('has 1 page,');
    expect(errorText(many, t)).toContain('has 10 pages,');
  });

  it('renders the same error in Hebrew, including the dual form', () => {
    const two = new RangeParseError('range.outOfRange', { n: 2, page: 3 });
    expect(errorText(two, tHe)).toContain('שני עמודים');
    expect(errorText(new UserError('error.encrypted'), tHe)).toMatch(/[֐-׿]/);
  });

  it('translates a keyed error that crossed the IPC boundary', () => {
    expect(errorText(new IpcError('error.notPdf', 'qpdf: not a PDF file'), t))
      .toBe('This file doesn’t look like a PDF.');
  });

  it('falls back to qpdf own words when the key is unrecognised', () => {
    // An unclassified failure must reach the user, not be swallowed by a
    // generic message.
    const err = new IpcError('error.somethingNew', 'qpdf: exploded in a novel way');
    expect(errorText(err, t)).toBe('qpdf: exploded in a novel way');
  });

  it('falls back to the generic message when there is no key and no detail', () => {
    expect(errorText(new IpcError(undefined, undefined), t))
      .toBe('qpdf could not process this file.');
  });

  it('passes a plain Error through unchanged', () => {
    expect(errorText(new Error('something local broke'), t)).toBe('something local broke');
  });

  it('copes with a thrown non-Error', () => {
    expect(errorText('just a string', t)).toBe('just a string');
  });

  it('subclasses of UserError resolve like the base', () => {
    const err = new UnsupportedImageError('image.tiffEmpty');
    expect(errorText(err, t)).toBe('That TIFF contains no image.');
    expect(errorText(err, tHe)).toMatch(/TIFF/);
  });

  it('every error key the code can throw exists in both dictionaries', () => {
    // Guards against a key being renamed in strings.ts but not at the throw site.
    const keys: StringKey[] = [
      'error.encrypted', 'error.notPdf', 'error.missing', 'error.qpdf',
      'error.selectAtLeastOnePage', 'error.needTwoPdfs', 'error.noCanvas',
      'range.backwards', 'range.notARange', 'range.startsAtOne', 'range.outOfRange',
      'range.badChunkSize', 'range.noBookmarks', 'range.pointOutside',
      'image.unreadable', 'image.heicEmpty', 'image.heicFailed',
      'image.tiffEmpty', 'image.tiffFailed', 'image.encodeFailed',
    ];
    for (const key of keys) {
      expect(en[key], `en is missing ${key}`).toBeDefined();
      expect(he[key], `he is missing ${key}`).toBeDefined();
    }
  });
});
