/**
 * EVIDENCE FOR "THE BOT DID NOT ANSWER" (command #51). When the bot never answers on the emulator, the cause (the engine WebView never loaded / its renderer died / the GPU
 * surface failed - "Failed to find ColorBuffer / Failed to bind to texture" was seen in the same minute) was invisible in the job log. These pure helpers pick the few log lines
 * that can name it; e2e.mjs prints them. Pure (no adb, no fs) so tests/ can pin them.
 */

export const EVIDENCE_MAX_LINES = 80;

// logcat's "threadtime" format: "MM-DD HH:MM:SS.mmm  PID  TID P Tag: message" (the tag may be padded with spaces before the colon).
const TAG_RE = /^\S+\s+\S+\s+\d+\s+\d+\s+[VDIWEF]\s+(\S+?)\s*:/;
const TAG_WANTED = /^(chromium|cr_[\w.]*|WebView[\w.]*|ReactNativeJS|AndroidRuntime|libc)$/;
// the emulator's GPU lines that were in the same minute as the one hang seen on CI (their tags are the emulator's own, not in the list above)
const MESSAGE_WANTED = /Failed to find ColorBuffer|Failed to bind to texture/;

/** The lines of a logcat dump that carry one of the wanted tags (chromium, cr_*, WebView*, ReactNativeJS, AndroidRuntime, libc) or the emulator GPU failure; the LAST `max` of them. */
export function filterEngineLogcat(logcat, max = EVIDENCE_MAX_LINES) {
  const kept = [];
  for (const line of String(logcat).split('\n')) {
    const tag = TAG_RE.exec(line)?.[1];
    if ((tag !== undefined && TAG_WANTED.test(tag)) || MESSAGE_WANTED.test(line)) kept.push(line.trimEnd().slice(0, 300));
  }
  return kept.slice(-max);
}

/** A line of the app's Diagnostics log: an ISO timestamp, then the entry ("2026-11-19T10:00:00.000Z [TextFit] ..."). */
const DIAGNOSTIC_LINE = /^\d{4}-\d\d-\d\dT[\d:.]+Z\s/;

/**
 * THE WHOLE TAIL of the app's Diagnostics log (command #58: "text-fit probe" / "piece gallery pixels" failed on a CI emulator and the job log said nothing about the app): every timestamped
 * entry among the words on the Diagnostics screen, whatever its tag, de-duplicated, order kept, the last `max`. Pure.
 */
export function diagnosticTail(words, max = 40) {
  const seen = new Set();
  const out = [];
  for (const word of words) {
    for (const line of String(word).split('\n')) {
      if (!DIAGNOSTIC_LINE.test(line) || seen.has(line)) continue;
      seen.add(line);
      out.push(line.trim().slice(0, 300));
    }
  }
  return out.slice(-max);
}

/** The engine's own lines of the app's Diagnostics log ("[Engine] ..." and "[EngineBridge] ..."), from the words on the Diagnostics screen; de-duplicated, order kept, the last `max`. */
export function engineDiagnosticLines(words, max = 40) {
  const seen = new Set();
  const out = [];
  for (const word of words) {
    for (const line of String(word).split('\n')) {
      if (!/\[Engine(Bridge)?\]/.test(line) || seen.has(line)) continue;
      seen.add(line);
      out.push(line.trim().slice(0, 300));
    }
  }
  return out.slice(-max);
}
