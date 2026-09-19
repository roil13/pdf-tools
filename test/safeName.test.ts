import { describe, it, expect } from 'vitest';
import { safeName, uniquify, padIndex } from '../src/lib/safeName.js';

const CTRL = String.fromCharCode(0x07); // a control character, built without a literal byte

describe('safeName', () => {
  it('keeps ordinary titles, including spaces, hyphens and Hebrew', () => {
    expect(safeName('Chapter One')).toBe('Chapter One');
    expect(safeName('Part 1 - Intro')).toBe('Part 1 - Intro');
    expect(safeName('פרק שלוש')).toBe('פרק שלוש');
  });

  it('replaces characters Windows forbids', () => {
    const BACKSLASH = String.fromCharCode(92);
    expect(safeName(`a/b${BACKSLASH}c:d*e?f"g<h>i|j`)).toBe('a b c d e f g h i j');
  });

  it('strips control characters', () => {
    expect(safeName(`a${CTRL}b`)).toBe('a b');
  });

  it('drops trailing dots and spaces that Explorer would strip anyway', () => {
    expect(safeName('Report...')).toBe('Report');
    expect(safeName('Report   ')).toBe('Report');
  });

  it('escapes reserved device names, which are invalid even with an extension', () => {
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('com1')).toBe('_com1');
    expect(safeName('CONTENTS')).toBe('CONTENTS'); // only exact matches are reserved
  });

  it('falls back when nothing usable is left', () => {
    expect(safeName('///')).toBe('part');
    expect(safeName('', 'page')).toBe('page');
  });

  it('truncates very long titles without leaving a trailing dot', () => {
    expect(safeName('x'.repeat(300)).length).toBe(100);
  });
});

describe('uniquify', () => {
  it('numbers repeats and is case-insensitive like Windows', () => {
    expect(uniquify(['a', 'b', 'a', 'A'])).toEqual(['a', 'b', 'a (2)', 'A (3)']);
  });

  it('leaves already-unique names alone', () => {
    expect(uniquify(['x', 'y'])).toEqual(['x', 'y']);
  });
});

describe('padIndex', () => {
  it('pads to the width of the total so Explorer sorts correctly', () => {
    expect(padIndex(7, 100)).toBe('007');
    expect(padIndex(7, 9)).toBe('7');
    expect(padIndex(12, 12)).toBe('12');
  });
});
