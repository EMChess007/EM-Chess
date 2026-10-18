import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The behaviour of the "tap message" hook (useCaptureNudge), run against a tiny hook runtime that keeps state between renders and runs effect
 * cleanups on unmount - and fake timers. The wording / colours / wiring live in giveawayHints.test.ts; this file pins what the timer does:
 * the message appears on a tap, goes away after CAPTURE_NUDGE_MS, a second tap restarts the countdown, and nothing fires after unmount.
 */

const runtime = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, cleanups: [] as Array<() => void> }));

vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = { current: initial };
    return runtime.slots[i];
  },
  useState: (initial: unknown) => {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) runtime.slots[i] = { value: initial };
    const slot = runtime.slots[i] as { value: unknown };
    return [slot.value, (next: unknown) => (slot.value = next)];
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => void | (() => void)) => {
    const i = runtime.cursor++;
    if (!(i in runtime.slots)) {
      runtime.slots[i] = true;
      const cleanup = effect();
      if (cleanup) runtime.cleanups.push(cleanup);
    }
  },
}));

import { CAPTURE_NUDGE_MS } from '../giveawayHints';
import { useCaptureNudge } from '../useCaptureNudge';

const render = () => {
  runtime.cursor = 0;
  return useCaptureNudge();
};

beforeEach(() => {
  runtime.slots = [];
  runtime.cleanups = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('useCaptureNudge', () => {
  it('off at first, on right after a tap, off again after CAPTURE_NUDGE_MS', () => {
    expect(render().nudged).toBe(false);
    render().nudge();
    expect(render().nudged).toBe(true);
    vi.advanceTimersByTime(CAPTURE_NUDGE_MS - 1);
    expect(render().nudged).toBe(true);
    vi.advanceTimersByTime(1);
    expect(render().nudged).toBe(false);
  });

  it('a second tap restarts the countdown (the message does not vanish 3.2 s after the FIRST tap)', () => {
    render().nudge();
    vi.advanceTimersByTime(CAPTURE_NUDGE_MS - 500);
    render().nudge();
    vi.advanceTimersByTime(1000); // 500 ms past the first tap's deadline
    expect(render().nudged).toBe(true);
    vi.advanceTimersByTime(CAPTURE_NUDGE_MS);
    expect(render().nudged).toBe(false);
  });

  it('unmounting cancels the pending timer (no state update after the screen is gone)', () => {
    render().nudge();
    expect(vi.getTimerCount()).toBe(1);
    runtime.cleanups.forEach((fn) => fn());
    expect(vi.getTimerCount()).toBe(0);
  });
});
