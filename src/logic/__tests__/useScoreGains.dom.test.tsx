import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCORE_GAIN_HOLD_MS, useScoreGains } from '../useScoreGains';

/**
 * The "+N" hook (src/logic/useScoreGains.ts), on its own: it turns two consecutive (score, ply) pairs into the gains to show, holds them, replaces them with the next ones,
 * and keeps quiet for the first position, for Undo, for a long jump and when it is switched off. No wall clock: fake timers.
 */
type Pos = { score: readonly number[]; ply: number };
const at = (score: number[], ply: number): Pos => ({ score, ply });

beforeEach(() => {
  vi.useFakeTimers();
});

const mount = (initial: Pos | null, enabled = true, holdMs?: number) => renderHook(({ pos, on }: { pos: Pos | null; on: boolean }) => useScoreGains(pos, on, holdMs), { initialProps: { pos: initial, on: enabled } });

describe('useScoreGains', () => {
  it('remembers the first position and announces nothing for it', () => {
    const { result } = mount(at([5, 0, 0, 0], 12));
    expect(result.current).toEqual([]);
  });

  it('shows the seats that scored between two positions, then drops them after the hold time (and not before)', () => {
    expect(SCORE_GAIN_HOLD_MS).toBe(1800); // pinned as a literal: the boundary below follows the constant
    const { result, rerender } = mount(at([0, 0, 0, 0], 4));
    rerender({ pos: at([0, 3, 0, 1], 5), on: true });
    expect(result.current).toEqual([{ seat: 1, points: 3 }, { seat: 3, points: 1 }]);
    act(() => {
      vi.advanceTimersByTime(1799);
    });
    expect(result.current).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toEqual([]);
  });

  it('after Undo the old timer is gone: it cannot cut short the gain that comes next', () => {
    const { result, rerender } = mount(at([0, 0, 0, 0], 4), true, 1000);
    rerender({ pos: at([1, 0, 0, 0], 5), on: true });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    rerender({ pos: at([0, 0, 0, 0], 4), on: true }); // Undo: cleared at once
    expect(result.current).toEqual([]);
    rerender({ pos: at([0, 2, 0, 0], 5), on: true }); // a new gain, at t = 600
    act(() => {
      vi.advanceTimersByTime(500); // t = 1100: the OLD timer (due at 1000) must not have cleared it
    });
    expect(result.current).toEqual([{ seat: 1, points: 2 }]);
    act(() => {
      vi.advanceTimersByTime(501);
    });
    expect(result.current).toEqual([]);
  });

  it('a position that goes away and comes back (a screen loading again) is a first position again: the jump between them is not a gain', () => {
    const { result, rerender } = mount(at([0, 0, 0, 0], 10));
    rerender({ pos: null, on: true });
    rerender({ pos: at([0, 0, 5, 0], 12), on: true });
    expect(result.current).toEqual([]);
  });

  it('a move that scores nothing leaves a gain that is still showing alone, and the next gain replaces it and restarts the hold', () => {
    const { result, rerender } = mount(at([0, 0, 0, 0], 4), true, 1000);
    rerender({ pos: at([1, 0, 0, 0], 5), on: true });
    expect(result.current).toEqual([{ seat: 0, points: 1 }]);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    rerender({ pos: at([1, 0, 0, 0], 6), on: true }); // a quiet move: nothing new, nothing cleared
    expect(result.current).toEqual([{ seat: 0, points: 1 }]);
    rerender({ pos: at([1, 5, 0, 0], 7), on: true });
    expect(result.current).toEqual([{ seat: 1, points: 5 }]); // replaced
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(result.current).toEqual([{ seat: 1, points: 5 }]); // the hold restarted with the new gain: the old timer did not cut it short
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toEqual([]);
  });

  it('Undo (the ply goes down) clears at once, and so does a long jump of the position (a catch-up after lost messages), which announces nothing', () => {
    const { result, rerender } = mount(at([0, 0, 0, 0], 10));
    rerender({ pos: at([2, 0, 0, 0], 11), on: true });
    expect(result.current).toHaveLength(1);
    rerender({ pos: at([0, 0, 0, 0], 10), on: true });
    expect(result.current).toEqual([]);
    rerender({ pos: at([4, 0, 0, 0], 11), on: true });
    expect(result.current).toHaveLength(1);
    rerender({ pos: at([9, 3, 0, 0], 40), on: true });
    expect(result.current).toEqual([]);
    rerender({ pos: at([9, 3, 1, 0], 41), on: true }); // and normal service resumes from there
    expect(result.current).toEqual([{ seat: 2, points: 1 }]);
  });

  it('a jump of exactly a few plies (a move and some walks of dead kings) still announces, at the edge of the limit', () => {
    const { result, rerender } = mount(at([0, 0, 0, 0], 10));
    rerender({ pos: at([3, 0, 0, 0], 18), on: true }); // 8 plies
    expect(result.current).toEqual([{ seat: 0, points: 3 }]);
    rerender({ pos: at([6, 0, 0, 0], 27), on: true }); // 9 plies: too far
    expect(result.current).toEqual([]);
  });

  it('does nothing when switched off, and starts from the next position when switched on', () => {
    const { result, rerender } = mount(at([0, 0, 0, 0], 3), false);
    rerender({ pos: at([2, 0, 0, 0], 4), on: false });
    expect(result.current).toEqual([]);
    rerender({ pos: at([2, 0, 0, 3], 5), on: true });
    expect(result.current).toEqual([{ seat: 3, points: 3 }]); // only what changed since the last position it saw
  });

  it('no position yet (an online game still loading): the first one that arrives is only remembered', () => {
    const { result, rerender } = mount(null);
    rerender({ pos: at([0, 9, 0, 0], 20), on: true });
    expect(result.current).toEqual([]);
    rerender({ pos: at([0, 9, 4, 0], 21), on: true });
    expect(result.current).toEqual([{ seat: 2, points: 4 }]);
  });

  it('leaves no timer behind when the screen goes away', () => {
    const { rerender, unmount } = mount(at([0, 0, 0, 0], 1));
    rerender({ pos: at([1, 0, 0, 0], 2), on: true });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
