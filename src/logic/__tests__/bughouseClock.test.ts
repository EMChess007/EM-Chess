import { describe, expect, it } from 'vitest';
import { afterMove, deadlineOf, flagLoser, frozen, isRunning, isWholeMs, remainingAt, started, type RunningClock, type SeatClock } from '../bughouse';

/** The clock helpers on their own, with literals (BUGHOUSE_SPEC.md rules 24-25, HP2). */
const running = (remainingMs: number, runningSince: number, startSeq = 0): SeatClock => ({ remainingMs, runningSince, startSeq });
const stopped = (remainingMs: number, startSeq = 0): SeatClock => ({ remainingMs, runningSince: null, startSeq });

describe('whole milliseconds', () => {
  it('accepts 0 and ordinary integers, refuses negatives, fractions, NaN, infinity, strings, null and integers beyond 2^53', () => {
    for (const ok of [0, 1, 999, 1_000_000, Number.MAX_SAFE_INTEGER]) expect(isWholeMs(ok), String(ok)).toBe(true);
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined, 2 ** 53, 2 ** 60]) expect(isWholeMs(bad), String(bad)).toBe(false);
  });
});

describe('a clock', () => {
  it('runs or it does not, and its flag falls at since + remaining', () => {
    expect(isRunning(running(100, 5))).toBe(true);
    expect(isRunning(stopped(100))).toBe(false);
    expect(deadlineOf(running(100, 5))).toBe(105);
    expect(deadlineOf(running(0, 7))).toBe(7);
    expect(deadlineOf(stopped(100))).toBeNull();
  });

  it('remainingAt: the time left now, never below zero, and the stored amount for a stopped clock', () => {
    expect(remainingAt(running(100, 5), 5)).toBe(100);
    expect(remainingAt(running(100, 5), 45)).toBe(60);
    expect(remainingAt(running(100, 5), 105)).toBe(0);
    expect(remainingAt(running(100, 5), 106)).toBe(0); // past the flag: 0, not -1
    expect(remainingAt(running(100, 5), 5000)).toBe(0);
    expect(remainingAt(stopped(70), 9999)).toBe(70);
  });

  it('afterMove charges the time used, adds the increment, stops, and keeps the start seq', () => {
    expect(afterMove(running(100, 5, 3), 45, 0)).toEqual({ remainingMs: 60, runningSince: null, startSeq: 3 });
    expect(afterMove(running(100, 5, 3), 45, 7)).toEqual({ remainingMs: 67, runningSince: null, startSeq: 3 });
    expect(afterMove(running(100, 5, 0), 5, 2)).toEqual({ remainingMs: 102, runningSince: null, startSeq: 0 });
  });

  it('started keeps what is left, starts at the instant, and records the seq of the commit', () => {
    expect(started(stopped(80, 1), 500, 9)).toEqual({ remainingMs: 80, runningSince: 500, startSeq: 9 });
    expect(started(stopped(0, 0), 0, 0)).toEqual({ remainingMs: 0, runningSince: 0, startSeq: 0 });
  });

  it('frozen charges up to the instant and stops; a stopped clock is unchanged; the start seq stays', () => {
    expect(frozen(running(100, 5, 4), 45)).toEqual({ remainingMs: 60, runningSince: null, startSeq: 4 });
    expect(frozen(running(100, 5, 4), 5000)).toEqual({ remainingMs: 0, runningSince: null, startSeq: 4 });
    expect(frozen(stopped(33, 2), 9999)).toEqual({ remainingMs: 33, runningSince: null, startSeq: 2 });
  });
});

describe('flagLoser', () => {
  const a = (deadline: number, startSeq: number): RunningClock => ({ seat: 0, board: 'A', deadline, startSeq });
  const b = (deadline: number, startSeq: number): RunningClock => ({ seat: 2, board: 'B', deadline, startSeq });

  it('the earlier deadline loses, from either side', () => {
    expect(flagLoser(a(99, 5), b(100, 1), 0).seat).toBe(0);
    expect(flagLoser(b(99, 5), a(100, 1), 0).seat).toBe(2);
    expect(flagLoser(a(100, 5), b(99, 1), 1).seat).toBe(2);
  });

  it('equal deadlines: the lower start seq loses, from either side, whatever the room', () => {
    for (const room of [0, 1]) {
      expect(flagLoser(a(100, 3), b(100, 4), room).seat).toBe(0);
      expect(flagLoser(a(100, 4), b(100, 3), room).seat).toBe(2);
      expect(flagLoser(b(100, 3), a(100, 4), room).seat).toBe(2);
    }
  });

  it('equal deadlines and start seq: an even room makes board A lose, an odd room board B, from either side', () => {
    for (const room of [0, 2, 10]) {
      expect(flagLoser(a(100, 3), b(100, 3), room).board).toBe('A');
      expect(flagLoser(b(100, 3), a(100, 3), room).board).toBe('A');
    }
    for (const room of [1, 3, 11]) {
      expect(flagLoser(a(100, 3), b(100, 3), room).board).toBe('B');
      expect(flagLoser(b(100, 3), a(100, 3), room).board).toBe('B');
    }
  });
});
