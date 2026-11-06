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

/** A start dump slower than this (ms) makes a failure that is ONLY a missing node / a timeout a RUNNER failure (command #43; the measured healthy runs dump in 2.3 - 3.0 s, the failing ones in 5.2 - 12.7 s). */
export const SLOW_DUMP_MS = 4000;

/** The text of a failure that only says "the screen did not show up in time": a missing node or a timeout. Wrong text, wrong pixels, a crash and a failed assertion never match. */
const WAIT_FAILURE = /cannot find|timed out/i;
export const isWaitFailure = (issue) => WAIT_FAILURE.test(String(issue));

/**
 * The label of a slice's attempt: "" when it passed, "RUNNER" when it failed and
 *   - either reading (start or end) was over the HEALTH_LIMITS (the old rule: any failure of such a runner), or
 *   - the start dump took more than SLOW_DUMP_MS and EVERY failure (`issues`, all the issue texts of the failed checks) is a wait failure ("cannot find" / "timed out");
 * "APP" otherwise (a crash, wrong pixels, wrong text, a failed assertion stays APP on any runner). `health` is { start: reading, end: reading }.
 */
export function labelAttempt({ failed, health, issues = /** @type {string[]} */ ([]) }) {
  if (!failed) return '';
  const slow = [health?.start, health?.end].some((reading) => reading && judgeHealth(reading).slow);
  if (slow) return 'RUNNER';
  const dump = health?.start?.dumpMs;
  const slowDump = typeof dump === 'number' && dump > SLOW_DUMP_MS;
  return slowDump && Array.isArray(issues) && issues.length > 0 && issues.every(isWaitFailure) ? 'RUNNER' : 'APP';
}

/** The exit status of the driver: 0 passed, EXIT_RUNNER failed on a slow runner (the shell retries it once), 1 failed on a healthy runner. */
export function exitStatus({ failed, health, issues = /** @type {string[]} */ ([]) }) {
  const label = labelAttempt({ failed, health, issues });
  return label === '' ? 0 : label === 'RUNNER' ? EXIT_RUNNER : 1;
}

// --- the slow-runner behaviour of the driver (command #43): pure decisions, tested with fake dumps -------------------------------------------------------------------------------

/** The start dump of a healthy runner (ms): run 42217508552 measured 2.3 - 3.0 s. */
export const HEALTHY_DUMP_MS = 3000;

/** The factor every wait of the slice is multiplied by: the start dump over 3 s (the healthy number), never below 1, never above 5 (a dead runner must still end). A failed / missing dump counts as 5. */
export function timeoutScale(dumpMs) {
  if (typeof dumpMs !== 'number' || dumpMs < 0) return 5;
  return Math.min(5, Math.max(1, dumpMs / HEALTHY_DUMP_MS));
}

/** Are two bounds the same rectangle? (A target that is still sliding or laying out differs between two dumps.) */
export function sameBounds(a, b) {
  return !!a && !!b && a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

/** What to do with the target after reading it: its bounds in the previous dump (`previous`, null for the first reading) against the current ones. 'tap' only on two equal readings in a row. */
export function stableDecision(previous, current) {
  return sameBounds(previous, current) ? 'tap' : 'wait';
}

/**
 * After a tap: `changed` = the tree is no longer the one the tap was made on, `expectedVisible` = the next step's target is already on screen, `retapped` = the step was already tapped a second
 * time. 'ok' when the screen moved on; 'retap' ONCE when it did not; 'give-up' otherwise (the next step then fails with its own message, which is the honest one).
 */
export function retapDecision({ changed, expectedVisible, retapped }) {
  if (changed || expectedVisible) return 'ok';
  return retapped ? 'give-up' : 'retap';
}
