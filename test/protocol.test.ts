/**
 * The containment rule for the app:// scheme.
 *
 * This is a security boundary and serving the app only ever exercises the paths
 * that succeed, so the refusals had no coverage at all until this file.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveWithin } from '../electron/protocol.js';

const BASE = path.resolve('C:/app/dist');
const inside = (p: string | null) => p !== null && p.startsWith(BASE);

describe('resolveWithin — serves', () => {
  it('the index for the root', () => {
    expect(resolveWithin(BASE, '/')).toBe(path.join(BASE, 'index.html'));
    expect(resolveWithin(BASE, '')).toBe(path.join(BASE, 'index.html'));
  });

  it('a normal asset', () => {
    expect(resolveWithin(BASE, '/assets/index.js')).toBe(path.join(BASE, 'assets/index.js'));
  });

  it('a nested asset', () => {
    expect(resolveWithin(BASE, '/tesseract/core/tesseract-core-simd-lstm.wasm'))
      .toBe(path.join(BASE, 'tesseract/core/tesseract-core-simd-lstm.wasm'));
  });

  it('a percent-encoded name', () => {
    expect(resolveWithin(BASE, '/fonts/Noto%20Sans.ttf')).toBe(path.join(BASE, 'fonts/Noto Sans.ttf'));
  });

  it('a path with redundant leading slashes', () => {
    expect(inside(resolveWithin(BASE, '///index.html'))).toBe(true);
  });

  it('an interior .. that stays inside', () => {
    expect(resolveWithin(BASE, '/assets/../index.html')).toBe(path.join(BASE, 'index.html'));
  });
});

describe('resolveWithin — refuses', () => {
  it('a traversal above the served directory', () => {
    expect(resolveWithin(BASE, '/../secrets.txt')).toBeNull();
    expect(resolveWithin(BASE, '/../../Windows/System32/config/SAM')).toBeNull();
  });

  it('a deep traversal that lands back near the root', () => {
    expect(resolveWithin(BASE, '/a/b/c/../../../../outside.txt')).toBeNull();
  });

  it('a percent-encoded traversal', () => {
    // %2e%2e is "..", and decoding happens before the containment test.
    expect(resolveWithin(BASE, '/%2e%2e/secrets.txt')).toBeNull();
    expect(resolveWithin(BASE, '/%2E%2E%2Fsecrets.txt')).toBeNull();
  });

  it('a doubly-encoded traversal', () => {
    // %252e decodes once to %2e, which is not a separator -- so this resolves
    // to a literal filename inside the directory rather than escaping.
    const r = resolveWithin(BASE, '/%252e%252e/x');
    expect(r === null || inside(r)).toBe(true);
  });

  it('a malformed percent-escape rather than throwing', () => {
    expect(resolveWithin(BASE, '/%ZZ')).toBeNull();
    expect(resolveWithin(BASE, '/%')).toBeNull();
  });

  it('a sibling directory sharing the base name as a prefix', () => {
    // "C:/app/dist-secret" must not pass a naive startsWith(base) test.
    expect(resolveWithin(BASE, '/../dist-secret/file.txt')).toBeNull();
  });

  it('an absolute path smuggled into the request', () => {
    const r = resolveWithin(BASE, '/C:/Windows/System32/drivers/etc/hosts');
    expect(r === null || inside(r)).toBe(true);
  });
});
