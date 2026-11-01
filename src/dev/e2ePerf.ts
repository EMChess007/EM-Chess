import { e2eReport } from './e2eBeacon';

/**
 * DEV ONLY, and only for the Android end-to-end run (command #33, the lag on the phone; the same switch and the same registry as the state probe, `registerE2e.ts` ->
 * `devOverlayRegistry.ts`). A release build and an ordinary development build contain none of it: `getE2ePerf()` is null there and every call site is `getE2ePerf()?.start(...)`.
 *
 * It answers two questions with numbers instead of impressions:
 *  1. HOW LONG does the app take to show what the finger did? `start(kind, channel)` is called where an input is understood (a tap on a square, a bot move being applied, a Bughouse action),
 *     `end(channel)` where the board's state probe has committed the new state (E2eStateProbe's effect). The time to the COMMIT is `commitMs`; `frameMs` is the time to two animation
 *     frames after it, which is when the new picture has been drawn. Both are reported to the driver (beacon channel `perf`), with the kind.
 *  2. IS THE JAVASCRIPT THREAD BUSY? A 20 ms interval measures how late it fires. The sum of the lateness (`lateMs`) over a window is the thread's busy time in it, and any single gap of 50 ms
 *     or more is listed with the wall-clock time it happened: "no frame longer than 250 ms during a Bughouse game with both clocks running" is read from this list.
 * Nothing here is read by the app itself, nothing is kept beyond a few hundred small numbers, and the report is the beacon's (a plain POST to the driver, development build only).
 */
const INTERVAL_MS = 20;
const MIN_STALL_MS = 50;
const MAX_STALLS = 80;
const MAX_LATENCIES = 120;
const REPORT_EVERY_MS = 500;

export interface E2ePerf {
  start: (kind: string, channel: string) => void;
  end: (channel: string) => void;
}

interface Latency {
  kind: string;
  channel: string;
  commitMs: number;
  frameMs: number;
  at: number;
}

const clock = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const nextFrame = (callback: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
  else setTimeout(callback, 16);
};

/** Starts the monitor and returns the object the registry hands to the call sites. Called once, by registerE2e.ts. */
export function createE2ePerf(): E2ePerf {
  const pending = new Map<string, { kind: string; t0: number }>();
  const latencies: Latency[] = [];
  const stalls: [number, number][] = [];
  let ticks = 0;
  let lateMs = 0;
  let maxGapMs = 0;
  const startedAt = Date.now();

  let last = clock();
  setInterval(() => {
    const t = clock();
    const gap = t - last - INTERVAL_MS;
    last = t;
    ticks++;
    if (gap > 0) lateMs += gap;
    if (gap > maxGapMs) maxGapMs = gap;
    if (gap >= MIN_STALL_MS) {
      stalls.push([Date.now(), Math.round(gap)]);
      if (stalls.length > MAX_STALLS) stalls.shift();
    }
  }, INTERVAL_MS);

  setInterval(() => {
    e2eReport('perf', { now: Date.now(), startedAt, ticks, lateMs: Math.round(lateMs), maxGapMs: Math.round(maxGapMs), stalls, latencies });
  }, REPORT_EVERY_MS);

  return {
    start(kind, channel) {
      pending.set(channel, { kind, t0: clock() });
    },
    end(channel) {
      const p = pending.get(channel);
      if (!p) return;
      pending.delete(channel);
      const commitMs = clock() - p.t0;
      // an input that changed nothing is closed by the NEXT change of the board, long after: such a reading is not a latency
      if (commitMs > 3000) return;
      nextFrame(() =>
        nextFrame(() => {
          latencies.push({ kind: p.kind, channel, commitMs: Math.round(commitMs * 10) / 10, frameMs: Math.round((clock() - p.t0) * 10) / 10, at: Date.now() });
          if (latencies.length > MAX_LATENCIES) latencies.shift();
        })
      );
    },
  };
}
