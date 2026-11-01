import { describe, expect, it } from 'vitest';
import { EMULATOR_FACTOR, HEALTHY_INPUT_MS, PHONE_BUDGET, judgePerf, percentile, scaledBudget, summarize, windowStats } from '../../../scripts/android/lib/perf.mjs';

/**
 * The arithmetic of the performance budget (scripts/android/lib/perf.mjs, command #33): pure, so a budget that could never fail, or one that fails on a healthy run, shows here and
 * not on the first red emulator run. The limits are literals: the user's own numbers (select 100 ms, move 150 ms, no gap of 250 ms) are the ones a phone is held to.
 */
describe('the performance budget', () => {
  it('holds the phone to the limits the user named', () => {
    expect(PHONE_BUDGET).toMatchObject({ selectP95Ms: 100, moveP95Ms: 150, stallMs: 250 });
  });

  it('percentile is the nearest rank', () => {
    expect(percentile([5, 1, 9, 3, 7], 0.5)).toBe(5);
    expect(percentile([5, 1, 9, 3, 7], 0.95)).toBe(9);
    expect(percentile([4], 0.95)).toBe(4);
    expect(percentile([], 0.5)).toBeNaN();
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.95)).toBe(19);
  });

  it('the budget is scaled by the emulator factor and by a slow runner, never below the factor', () => {
    const healthy = scaledBudget({ start: { inputMs: 400 }, end: { inputMs: 500 } });
    expect(healthy.selectP95Ms).toBe(100 * EMULATOR_FACTOR);
    expect(healthy.stallMs).toBe(250 * EMULATOR_FACTOR);
    const slow = scaledBudget({ start: { inputMs: HEALTHY_INPUT_MS * 2 }, end: { inputMs: 300 } });
    expect(slow.moveP95Ms).toBe(150 * EMULATOR_FACTOR * 2);
    expect(scaledBudget(undefined).selectP95Ms).toBe(100 * EMULATOR_FACTOR);
  });

  it('windowStats reads the thread between two reports on the app clock', () => {
    const a = { now: 1000, lateMs: 100, stalls: [[900, 400]] };
    const b = { now: 3000, lateMs: 400, stalls: [[900, 400], [1500, 120], [2500, 300]] };
    expect(windowStats(a, b)).toEqual({ wallMs: 2000, busyShare: 0.15, maxStallMs: 300, stalls100: 2, stalls250: 1 });
  });

  const fine = { select: [40, 50, 60, 70], move: [60, 70, 80, 90], botReply: [50, 60, 70], bugTap: [30, 40, 50, 60, 70, 80] };
  const calm = { name: 'idle', stats: { wallMs: 8000, busyShare: 0.05, maxStallMs: 60, stalls100: 0, stalls250: 0 } };
  const budget = { selectP95Ms: 100, moveP95Ms: 150, botReplyP95Ms: 150, bugTapP95Ms: 150, stallMs: 250, busyShare: 0.35 };

  it('passes a calm run and fails each kind of overrun with its own sentence', () => {
    expect(judgePerf({ samples: fine, windows: [calm] }, budget)).toEqual([]);
    // the MEDIAN is held to the limit: a slow typical tap fails ...
    expect(judgePerf({ samples: { ...fine, select: [101, 120, 130, 140] }, windows: [calm] }, budget)[0]).toMatch(/^select: the MEDIAN 120 ms .* over the budget of 100 ms/);
    expect(judgePerf({ samples: { ...fine, move: [151, 160, 170, 180] }, windows: [calm] }, budget)[0]).toMatch(/^move: the MEDIAN 160/);
    // ... one bad sample among good ones (a shared emulator's bad second) does not, until it is more than 2.5 x the limit
    expect(judgePerf({ samples: { ...fine, select: [40, 50, 60, 249] }, windows: [calm] }, budget)).toEqual([]);
    expect(judgePerf({ samples: { ...fine, select: [40, 50, 60, 251] }, windows: [calm] }, budget)[0]).toMatch(/^select: p95 251 ms .* over 2.5 x the budget of 100 ms/);
    expect(judgePerf({ samples: fine, windows: [{ name: 'Bughouse', stats: { ...calm.stats, maxStallMs: 250 } }] }, budget)[0]).toMatch(/Bughouse: the JavaScript thread stood still for 250 ms/);
    // the thread's lateness SHARE is reported, never judged (a 20 ms timer fires late by itself on the emulator); a long stall is
    expect(judgePerf({ samples: fine, windows: [{ name: 'Bughouse', idle: true, stats: { ...calm.stats, busyShare: 0.9 } }] }, budget)).toEqual([]);
  });

  it('too few samples is a finding, never a pass', () => {
    expect(judgePerf({ samples: { ...fine, select: [] }, windows: [calm] }, budget)[0]).toMatch(/^select: only 0 sample/);
  });

  it('summarize prints n, p50, p95 and max', () => {
    expect(summarize([10, 20, 30, 40])).toBe('n=4 p50=20 p95=40 max=40 ms');
    expect(summarize([])).toBe('no samples');
  });
});
