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

/** The logcat lines worth printing for ANY failure: the engine filter's tags plus ActivityManager lines that name an ANR; the LAST `max`. */
export function filterFailureLogcat(logcat, max = FAILURE_LOGCAT_MAX) {
  const kept = [];
  for (const line of String(logcat).split('\n')) {
    const tag = TAG_RE.exec(line)?.[1];
    const wanted = tag !== undefined && TAG_WANTED.test(tag);
    const anr = tag === 'ActivityManager' && ANR_LINE.test(line);
    if (wanted || anr || MESSAGE_WANTED.test(line)) kept.push(line.trimEnd().slice(0, 300));
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
export const EVIDENCE_PROBE = 'probe silent';
export const EVIDENCE_UNKNOWN = 'unknown';

/**
 * The one-word cause, in priority order, from what was collected. `startPid` / `pid` are numbers or null (null = no process); `logcat` the filtered lines; `issues` the failed
 * scenario's issue texts; `diagnosticLines` the Diagnostics tail. Anything the evidence does not show is "unknown".
 */
/** @param {{ startPid?: number | null, pid?: number | null, logcat?: string[], issues?: string[], diagnosticLines?: string[] }} [input] */
export function classifyEvidence({ startPid = null, pid = null, logcat = [], issues = [], diagnosticLines = [] } = {}) {
  const log = logcat.join('\n');
  if (/FATAL EXCEPTION|Fatal signal|SIGSEGV|AndroidRuntime/.test(log) || (startPid !== null && pid === null)) return EVIDENCE_CRASH;
  if (ANR_LINE.test(log)) return EVIDENCE_ANR;
  if (startPid !== null && pid !== null && pid !== startPid) return EVIDENCE_RESTARTED;
  const text = issues.join(' | ');
  if (/text-fit probe|piece gallery|gallery pixels|0 of \d+ cells|probe/i.test(text) && diagnosticLines.length === 0) return EVIDENCE_PROBE;
  if (/did not change|did not appear|not appear|still (on|shows)|no .* after (the )?tap|lost tap|never (opened|appeared)|not reachable|not found|not visible/i.test(text)) return EVIDENCE_TAP;
  return EVIDENCE_UNKNOWN;
}

/** The job-summary line for one failed scenario. */
export function evidenceLine(name, cause) {
  return `EVIDENCE: ${cause} (${name})`;
}
