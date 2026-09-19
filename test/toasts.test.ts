/**
 * The toast stack is bounded on purpose: errors and successes that offer an
 * action stay until dismissed, so an unbounded stack would push the oldest --
 * and their own dismiss buttons -- off the top of the screen.
 */
import { describe, it, expect } from 'vitest';

/** The reducer behaviour under test, matching useToasts' push. */
const MAX_TOASTS = 4;
const push = <T,>(prev: T[], next: T): T[] => [...prev, next].slice(-MAX_TOASTS);

describe('toast stack', () => {
  it('keeps everything below the cap', () => {
    let list: number[] = [];
    for (const n of [1, 2, 3]) list = push(list, n);
    expect(list).toEqual([1, 2, 3]);
  });

  it('drops the oldest once the cap is reached', () => {
    let list: number[] = [];
    for (const n of [1, 2, 3, 4, 5, 6]) list = push(list, n);
    expect(list).toEqual([3, 4, 5, 6]);
    expect(list).toHaveLength(MAX_TOASTS);
  });

  it('always keeps the newest, which is the one the user just caused', () => {
    let list: number[] = [];
    for (let n = 1; n <= 50; n++) list = push(list, n);
    expect(list[list.length - 1]).toBe(50);
    expect(list).toHaveLength(MAX_TOASTS);
  });
});
