/**
 * EVIDENCE ON EVERY android-e2e FAILURE (command #59). Strict-slice runs failed intermittently with "lost taps" and silent Diagnostics checks and the job log held only the screen text,
 * so the cause (crash / ANR / app restart / lost tap) was unproven. These pure helpers pick the log lines and classify the evidence; e2e.mjs prints them and the job summary shows
 * one "EVIDENCE: ..." line per failed scenario. Pure (no adb, no fs) so tests can pin them.
 */

export const FAILURE_LOGCAT_MAX = 80;
export const FAILURE_DIAGNOSTIC_MAX = 40;

const TAG_RE = /^\S+\s+\S+\s+\d+\s+\d+\s+[VDIWEF]\s+(\S+?)\s*:/;
const TAG_WANTED = /^(chromium|cr_[\w.]*|WebView[\w.]*|ReactNativeJS|AndroidRuntime|libc)$/;
const ANR_LINE = /ANR in|am_anr|Application Not Responding/;
const MESSAGE_WANTED = /Failed to find ColorBuffer|Failed to bind to texture/;

// (command #61) `uiautomator dump`, run by the harness through `adb shell` (uid 2000), starts its own VM and logs "AndroidRuntime: START ... RuntimeInit uid 2000", "Calling main entry
// com.android.commands.uiautomator.Launcher" and "Shutting down VM" on EVERY dump: PR #46 printed 64 of them as "crash" evidence while the app's pid never changed.
const SHELL_NOISE = /RuntimeInit uid \d+|Calling main entry com\.android\.commands|Shutting down VM/;
const PID_TAG_RE = /^\S+\s+\S+\s+(\d+)\s+\d+\s+[VDIWEF]\s+(\S+?)\s*:/;
const APP_PID_IN_LOG = [/Process: com\.emchess\.app, PID: (\d+)/g, /Start proc (\d+):com\.emchess\.app/g, /Process com\.emchess\.app \(pid (\d+)\)/g, /Killing (\d+):com\.emchess\.app/g];
// (command #62c) every ActivityManager / lmkd line about the app's process: its death and the reason (killed, force-stopped by the harness, low memory), and each new start - so the PREVIOUS
// pid's end is in the evidence too (PR #47 run 44871547772, online: pid 4547 -> 11091 with no line saying why; it was the harness's own `am force-stop` + `pm clear` in freshSignedIn)
const APP_DIED_LINE = /(Process com\.emchess\.app .*has died|Killing \d+:com\.emchess\.app|Force stopping com\.emchess\.app|Start proc \d+:com\.emchess\.app|lowmemorykiller.*com\.emchess\.app|com\.emchess\.app.*(low ?memory|lmk))/i;
const AM_TAGS = /^(ActivityManager|lmkd|lowmemorykiller)$/;
// these tags can come from the app's helper processes (the engine WebView's renderer): kept whatever their pid
const TAG_ANY_PID = /^(chromium|cr_[\w.]*|WebView[\w.]*)$/;

/** Every pid the app had in this log: the ones the caller knows (slice start, now) plus those named by its own crash block, ActivityManager's "Start proc" and "Process ... has died". */
export function appPidsIn(logcat, known = []) {
  const pids = new Set(known.filter((p) => typeof p === 'number'));
  for (const re of APP_PID_IN_LOG) for (const m of String(logcat).matchAll(re)) pids.add(Number(m[1]));
  return pids;
}

/**
 * The logcat lines worth printing for ANY failure, the LAST `max`: the app's OWN lines (ReactNativeJS / AndroidRuntime / libc of the app's pids), the engine WebView's chromium lines,
 * ActivityManager ANR lines and "Process com.emchess.app ... has died" lines. The harness's own processes (uiautomator, shell) are dropped: with the app's pids known (`appPids`, from the
 * caller and from the log itself) a line of any other pid goes; with none known the shell's AndroidRuntime START / Calling main entry / Shutting down VM lines still go.
 */
export function filterFailureLogcat(logcat, max = FAILURE_LOGCAT_MAX, appPids = []) {
  const pids = appPidsIn(logcat, appPids);
  const kept = [];
  for (const line of String(logcat).split('\n')) {
    const m = PID_TAG_RE.exec(line);
    const tag = m?.[2] ?? TAG_RE.exec(line)?.[1];
    const pid = m ? Number(m[1]) : null;
    const anr = tag !== undefined && AM_TAGS.test(tag) && (ANR_LINE.test(line) || APP_DIED_LINE.test(line));
    const own = tag !== undefined && TAG_WANTED.test(tag) && !TAG_ANY_PID.test(tag) && (pids.size > 0 ? pid !== null && pids.has(pid) : !SHELL_NOISE.test(line));
    const anyPid = tag !== undefined && TAG_ANY_PID.test(tag);
    if (own || anyPid || anr || MESSAGE_WANTED.test(line)) kept.push(line.trimEnd().slice(0, 300));
  }
  return kept.slice(-max);
}

/** The pid printed by `pidof` ("1234" / "1234 5678" / "no process") as the first number, or null. */
export function parsePid(text) {
  const m = /\d+/.exec(String(text));
  return m === null ? null : Number(m[0]);
}

export const EVIDENCE_CRASH = 'crash';
export const EVIDENCE_ANR = 'ANR';
export const EVIDENCE_RESTARTED = 'app restarted';
export const EVIDENCE_TAP = 'screen unchanged after tap';
export const EVIDENCE_TAP_LOST = 'tap lost';
export const EVIDENCE_PROBE = 'probe silent';
export const EVIDENCE_UNKNOWN = 'unknown';

/**
 * The one-word cause, in priority order, from what was collected. `startPid` / `pid` are numbers or null (null = no process); `logcat` the filtered lines; `issues` the failed
 * scenario's issue texts; `diagnosticLines` the Diagnostics tail; `tapsLost` the navigation taps of this scenario after which the screen's words were identical (command #61).
 * "crash" needs the app's own FATAL EXCEPTION / Fatal signal / SIGSEGV line or the process gone: a bare AndroidRuntime line is not one (uiautomator logs them on every dump).
 * Anything the evidence does not show is "unknown".
 */
/**
 * What a pid that is not the slice's first one means (command #62c). `harnessPids`: the pids of the processes the HARNESS started (`am start` after its own force-stop / pm clear: a fresh
 * signed-in app between online scenarios, a relaunch). Returns 'same' | 'harness' (the harness restarted the app on purpose: not a crash) | 'changed' (nobody in the harness did it).
 * @param {{ startPid?: number | null, pid?: number | null, harnessPids?: Iterable<number> }} input
 */
export function pidChange({ startPid = null, pid = null, harnessPids = [] }) {
  if (startPid === null || pid === null || pid === startPid) return 'same';
  return new Set(harnessPids).has(pid) ? 'harness' : 'changed';
}

/** @param {{ startPid?: number | null, pid?: number | null, harnessPids?: Iterable<number>, logcat?: string[], issues?: string[], diagnosticLines?: string[], tapsLost?: unknown[] }} [input] */
export function classifyEvidence({ startPid = null, pid = null, harnessPids = [], logcat = [], issues = [], diagnosticLines = [], tapsLost = [] } = {}) {
  const log = logcat.join('\n');
  if (/FATAL EXCEPTION|Fatal signal|SIGSEGV/.test(log) || (startPid !== null && pid === null)) return EVIDENCE_CRASH;
  if (ANR_LINE.test(log)) return EVIDENCE_ANR;
  if (pidChange({ startPid, pid, harnessPids }) === 'changed') return EVIDENCE_RESTARTED;
  if (tapsLost.length > 0) return EVIDENCE_TAP_LOST;
  const text = issues.join(' | ');
  if (/text-fit probe|piece gallery|gallery pixels|0 of \d+ cells|probe/i.test(text) && diagnosticLines.length === 0) return EVIDENCE_PROBE;
  if (/did not change|did not appear|not appear|still (on|shows)|no .* after (the )?tap|lost tap|never (opened|appeared)|not reachable|not found|not visible/i.test(text)) return EVIDENCE_TAP;
  return EVIDENCE_UNKNOWN;
}

/** The job-summary line for one failed scenario. */
export function evidenceLine(name, cause) {
  return `EVIDENCE: ${cause} (${name})`;
}
