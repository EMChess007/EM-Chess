/**
 * THE RUNNER HEALTH CHECK of the Android end-to-end run (command #32, TESTING.md section 48).
 *
 * A red slice has two kinds of cause: the APP (a bug the run exists to find) and the RUNNER (a GitHub-hosted emulator that was far too slow: a tap that waits seconds, an accessibility dump that
 * takes half a minute, so a blind scroll or a "wait for the state" runs out of time). Command #31's unexplained red run (the `online` and `small-gallery` slices of one push, green on the
 * same commit's next run) is the second kind, suspected and never proved. This module makes the difference MEASURED instead of guessed:
 *   - at the start of every slice, and again at its end, the driver times the phone's input path (`input keyevent 0`, the same app_process start-up that every tap pays) and one accessibility
 *     dump of the idle screen it starts from;
 *   - `judgeHealth` calls the runner SLOW above the limits below;
 *   - a slice that FAILS on a slow runner exits with `EXIT_RUNNER` (3) instead of 1, `run-on-emulator.sh` runs that slice ONCE more, and the digest labels every result "RUNNER" or "APP".
 * A retry never turns a red check green by itself: the slice's verdict is its LAST attempt, a slow runner that fails twice is red (labelled RUNNER), and a failure on a healthy runner is never
 * retried (that is an APP finding).
 *
 * The limits are literals, chosen from the measured emulator: a healthy API 34 swiftshader emulator on a hosted runner answers `input keyevent` in 0.3 - 0.8 s and dumps an idle launcher in
 * 1 - 4 s (the digests of runs 33 - 46); the limits are about three times the slowest healthy number. Nothing here reads a clock for an assertion: the numbers are reported and judged after.
 */

/** Exit status of the driver for "failed, and the runner was slow": the one status the shell retries. */
export const EXIT_RUNNER = 3;

/** Limits (milliseconds) above which the runner is called slow: the median of 5 input commands, and one dump of the idle start screen. */
export const HEALTH_LIMITS = { inputMs: 2500, dumpMs: 12000 };

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
};

/** The median time (ms) of `count` harmless input commands (`input keyevent 0` = KEYCODE_UNKNOWN: nothing in the app reacts to it). `now` and `run` are injectable for the tests. */
export function measureInput(dev, { count = 5, now = () => Date.now() } = {}) {
  const times = [];
  for (let i = 0; i < count; i++) {
    const t0 = now();
    dev.sh('input keyevent 0');
    times.push(now() - t0);
  }
  return median(times);
}

/** The time (ms) of one accessibility dump of whatever is on the screen; -1 when the dump failed outright (a failure to dump an IDLE screen is itself a slow runner). */
export async function measureDump(dev, { now = () => Date.now() } = {}) {
  const t0 = now();
  try {
    await dev.dump();
  } catch {
    return -1;
  }
  return now() - t0;
}

/** { inputMs, dumpMs? } -> { slow, reasons[] }. A missing `dumpMs` (the end-of-slice reading only times the input path) is not judged. */
export function judgeHealth(reading, limits = HEALTH_LIMITS) {
  const reasons = [];
  if (typeof reading.inputMs === 'number' && reading.inputMs > limits.inputMs) reasons.push(`input commands took ${reading.inputMs} ms (limit ${limits.inputMs})`);
  if (typeof reading.dumpMs === 'number' && (reading.dumpMs < 0 || reading.dumpMs > limits.dumpMs)) reasons.push(reading.dumpMs < 0 ? 'the accessibility dump of the idle start screen failed' : `an accessibility dump took ${reading.dumpMs} ms (limit ${limits.dumpMs})`);
  return { slow: reasons.length > 0, reasons };
}

/**
 * The label of a slice's attempt: "" when it passed, "RUNNER" when it failed and either reading (start or end) said the runner was slow, "APP" otherwise. `health` is
 * { start: reading, end: reading }.
 */
export function labelAttempt({ failed, health }) {
  if (!failed) return '';
  const slow = [health?.start, health?.end].some((reading) => reading && judgeHealth(reading).slow);
  return slow ? 'RUNNER' : 'APP';
}

/** The exit status of the driver: 0 passed, EXIT_RUNNER failed on a slow runner (the shell retries it once), 1 failed on a healthy runner. */
export function exitStatus({ failed, health }) {
  const label = labelAttempt({ failed, health });
  return label === '' ? 0 : label === 'RUNNER' ? EXIT_RUNNER : 1;
}
