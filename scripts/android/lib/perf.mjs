/**
 * THE PERFORMANCE BUDGET OF THE ANDROID END-TO-END RUN (command #33, TESTING.md section 49). The phone lagged ("κολλάει") in a 2-player game against a bot and in a local Bughouse game, and
 * no check could say so: every check waited for a state to arrive and none timed how long it took. The app (src/dev/e2ePerf.ts, the end-to-end build only) now measures, and this module is
 * the driver's side: the arithmetic over what the app reported, and the budget the run is judged against. No clock is read here (the numbers come from the app); every function is pure and
 * tested offline (src/logic/__tests__/androidPerf.test.ts).
 *
 * WHAT IS MEASURED, per input (the app's own stopwatch, started where the input is understood and stopped when the board's new state is committed (`commitMs`) and two animation frames later,
 * when the picture has been drawn (`frameMs`)): a tap that selects a piece, a tap that moves it, the bot's reply, a Bughouse tap. And the JavaScript thread itself: a 20 ms interval, how
 * LATE it fires (the sum is the thread's busy time; one gap of 250 ms or more is a frame the user sees as a freeze).
 *
 * THE BUDGET is judged on `frameMs` (the picture), at the 95th percentile of the samples of a kind, and on the longest gap of the thread, scaled by the runner's health (health.mjs): a
 * GitHub-hosted software-rendered emulator is slower than a phone, and a budget that failed on a slow runner would say nothing about the app. The limits below are the user's (select 100 ms,
 * move 150 ms, no gap of 250 ms) times the measured emulator factor `EMULATOR_FACTOR`, which the first runs of command #33 set from the numbers they read (TESTING.md section 49).
 */

/** The user's limits for a phone (milliseconds). */
export const PHONE_BUDGET = { selectP95Ms: 100, moveP95Ms: 150, botReplyP95Ms: 150, bugTapP95Ms: 150, stallMs: 250, busyShare: 0.35 };

/**
 * How much slower than a phone the CI emulator is allowed to be before the app is blamed: the budget the run enforces is `PHONE_BUDGET x EMULATOR_FACTOR`. 1 = the phone's own limits.
 * Set from the measured numbers (TESTING.md section 49); a literal on purpose.
 */
export const EMULATOR_FACTOR = 3;

/** The healthy runner's median `input keyevent 0` (health.mjs, 0.3 - 0.8 s): a runner slower than this scales the budget further, never below 1. */
export const HEALTHY_INPUT_MS = 800;

/** budget x emulator factor x the runner's slowness (>= 1). */
export function scaledBudget(health, budget = PHONE_BUDGET, factor = EMULATOR_FACTOR) {
  const input = Math.max(health?.start?.inputMs ?? 0, health?.end?.inputMs ?? 0);
  const slow = Math.max(1, input / HEALTHY_INPUT_MS);
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, value] of Object.entries(budget)) out[key] = key === 'busyShare' ? Math.min(0.95, value * Math.max(1, factor / 2) * slow) : Math.round(value * factor * slow);
  return out;
}

/** The p-th percentile (0 < p <= 1) by the nearest-rank method; NaN for no samples. */
export function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** Latencies of one kind from a report, optionally only the ones whose app-time `at` lies in (from, to]. */
export function latenciesOf(report, kind, from = -Infinity, to = Infinity) {
  return (report?.latencies ?? []).filter((l) => (kind === null || l.kind === kind) && l.at > from && l.at <= to);
}

/** The thread's behaviour between two reports of the app (a and b, in order): wall time, busy share, the longest gap and the stalls in the window, all on the APP's clock. */
export function windowStats(a, b) {
  const wallMs = b.now - a.now;
  const inWindow = (b.stalls ?? []).filter(([at]) => at > a.now && at <= b.now);
  return {
    wallMs,
    busyShare: wallMs > 0 ? (b.lateMs - a.lateMs) / wallMs : 0,
    maxStallMs: inWindow.reduce((m, [, gap]) => Math.max(m, gap), 0),
    stalls100: inWindow.filter(([, gap]) => gap >= 100).length,
    stalls250: inWindow.filter(([, gap]) => gap >= 250).length,
  };
}

/** A one-line summary of a list of samples: n, p50, p95, max (milliseconds). */
export function summarize(values) {
  if (values.length === 0) return 'no samples';
  const r = (v) => Math.round(v);
  return `n=${values.length} p50=${r(percentile(values, 0.5))} p95=${r(percentile(values, 0.95))} max=${r(Math.max(...values))} ms`;
}

/**
 * The verdict: a list of sentences (empty = within the budget). `samples` = { select, move, botReply, bugTap } (frameMs lists), `windows` = [{ name, stats }] for the stall checks. A kind with no
 * sample at all is itself a finding (the probe or the input did not work), never a pass.
 */
export function judgePerf({ samples, windows }, budget, minimum = { select: 4, move: 4, botReply: 3, bugTap: 6 }) {
  const issues = [];
  const limits = { select: budget.selectP95Ms, move: budget.moveP95Ms, botReply: budget.botReplyP95Ms, bugTap: budget.bugTapP95Ms };
  for (const kind of Object.keys(limits)) {
    const values = samples[kind] ?? [];
    if (values.length < minimum[kind]) {
      issues.push(`${kind}: only ${values.length} sample(s) (at least ${minimum[kind]} are needed): the input or the probe did not work`);
      continue;
    }
    // THE MEDIAN is held to the limit and the 95th percentile to OUTLIER_CEILING times it. The first two CI runs of command #33 on the same code read p95 = 450 ms and p95 = 1016 ms for the bot's
    // reply (eight samples: the p95 is the worst one, and a shared emulator has a bad second now and then), but the medians were 224 and 273 ms: the median is what the app does, the p95 only
    // has to say that nothing is wildly off. A budget that fails on runner noise says nothing about the app.
    const median = percentile(values, 0.5);
    const p95 = percentile(values, 0.95);
    if (median > limits[kind]) issues.push(`${kind}: the MEDIAN ${Math.round(median)} ms to the drawn frame is over the budget of ${limits[kind]} ms (${summarize(values)})`);
    else if (p95 > limits[kind] * OUTLIER_CEILING) issues.push(`${kind}: p95 ${Math.round(p95)} ms to the drawn frame is over ${OUTLIER_CEILING} x the budget of ${limits[kind]} ms (${summarize(values)})`);
  }
  for (const { name, stats, idle } of windows) {
    if (stats.maxStallMs >= budget.stallMs) issues.push(`${name}: the JavaScript thread stood still for ${stats.maxStallMs} ms (budget ${budget.stallMs} ms; ${stats.stalls250} gap(s) of 250 ms or more)`);
    // (the share is judged only in an IDLE window - the clocks and nothing else: while the driver injects touches, `adb shell input` starts a process on the emulator's two CPUs for every one, and
    // the first run read 57 % lateness in a window of sixteen taps against a few percent when idle; it is reported for those windows, not judged)
    if (idle && stats.busyShare > budget.busyShare) issues.push(`${name}: the JavaScript thread was ${Math.round(stats.busyShare * 100)} % late (budget ${Math.round(budget.busyShare * 100)} %)`);
  }
  return issues;
}

/** The 95th percentile may be this many times the limit that the median is held to. */
export const OUTLIER_CEILING = 2.5;
