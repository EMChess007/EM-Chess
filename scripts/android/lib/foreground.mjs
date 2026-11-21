/**
 * IS THE APP IN FRONT? (command #67b). PR #51, slice small-screens-2 (job 136821419780): after "screen more-diagnostics" the toHome path tapped the Diagnostics screen's "‹ Back" twice
 * (10:59:53, 10:59:59) and the tab bar's "Home" (11:00:02); from 11:00:15 on `mCurrentFocus` was the launcher (NexusLauncherActivity), so every later tab tap went to the Android home screen and
 * was reported as a "lost tap" with a SILENT JavaScript thread (the app was in the background, not busy). The same sequence (Diagnostics, "‹ Back" x 2, "Home") did it again at 11:07:25 - 11:07:33
 * in the same run. So before a touch the driver now asks Android which activity is RESUMED; when it is not the app (the launcher, a browser), the app's EXISTING task is brought to the front
 * (`am start` of the launcher intent: no new process, the screen the app was on comes back) and that is printed as EVIDENCE "app was in the background", never spent as a lost tap.
 * Pure (the dumpsys text is passed in) so tests can drive it.
 */

/** The package names a `dumpsys activity activities` text gives as RESUMED (`topResumedActivity=` / `mResumedActivity:` / `ResumedActivity:` lines), in order. */
export function resumedPackages(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!/(topResumedActivity|mResumedActivity|ResumedActivity)/.test(line)) continue;
    const m = /ActivityRecord\{\S+ u\d+ ([A-Za-z0-9_.]+)\//.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Packages that may hold the focus OVER the app without sending it to the background (a system dialog, the notification shade, a permission prompt): never "the app left". */
const OVERLAY_PACKAGES = ['android', 'com.android.systemui', 'com.android.permissioncontroller', 'com.google.android.permissioncontroller'];

/**
 * The verdict for one dumpsys text: 'front' (the app is the resumed activity, or a system overlay is), 'background' (another app - the launcher, a browser - is resumed) or 'unknown' (nothing
 * readable: never acted on, a failed read is not a background app).
 * @returns {{ state: 'front' | 'background' | 'unknown', resumed: string | null }}
 */
export function foregroundState(text, pkg) {
  const resumed = resumedPackages(text);
  if (resumed.length === 0) return { state: 'unknown', resumed: null };
  const top = resumed[0];
  if (top === pkg || OVERLAY_PACKAGES.includes(top)) return { state: 'front', resumed: top };
  return { state: 'background', resumed: top };
}

/** The shell command that brings the app's EXISTING task to the front (the launcher's own intent: a running task is resumed where it was, nothing is restarted). */
export const bringToFrontCommand = (pkg) => `am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${pkg}/.MainActivity`;

/**
 * HOLDS THE APP THE INPUT FOCUS? (command #68b). PR #52, slice large-touch (job 136908537492): the first tap ("More", 16:33:19) was lost with `mCurrentFocus` = the launcher's
 * NexusLauncherActivity window and `mFocusedApp` = the launcher, while `topResumedActivity` was the app (16:33:41). A RESUMED app whose window does not hold the focus gets no touch, so
 * "in front" now needs both. The one shell command below prints the resumed lines AND the focus lines, so one adb call answers both questions.
 */
export const IN_FRONT_PROBE =
  'dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity|ResumedActivity" | head -4; dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | head -4';

/** Windows that may hold the INPUT focus over the app without the app losing it for good: the overlays above plus the on-screen keyboard. */
const FOCUS_OVERLAY_PACKAGES = [...OVERLAY_PACKAGES, 'com.google.android.inputmethod.latin', 'com.android.inputmethod.latin'];

/**
 * The package that holds the input focus in a `dumpsys window` text: the `mCurrentFocus=Window{... u0 <pkg>/<activity>}` line when it names a package, else `mFocusedApp=ActivityRecord{... u0 <pkg>/...}`.
 * `mCurrentFocus=null` (a transition) or a window without a package (`Window{... u0 NotificationShade}`, a popup) reads as nothing on that line. Null when nothing is readable.
 */
export function focusedPackage(text) {
  const lines = String(text ?? '').split('\n');
  for (const key of ['mCurrentFocus', 'mFocusedApp']) {
    for (const line of lines) {
      const m = new RegExp(`${key}=\\w+\\{\\S+ u\\d+ ([A-Za-z0-9_.]+)/`).exec(line);
      if (m) return m[1];
    }
  }
  return null;
}

/**
 * The verdict for one IN_FRONT_PROBE text: 'front' only when the app (or a system overlay) is RESUMED and the INPUT FOCUS is not on another app; 'background' when another app is resumed
 * OR holds the focus (the run: the app resumed, the launcher focused); 'unknown' when the resumed lines are unreadable (never acted on). An unreadable focus line alone never blocks.
 * @returns {{ state: 'front' | 'background' | 'unknown', resumed: string | null, focused: string | null, why: string }}
 */
export function inFrontState(text, pkg) {
  const { state, resumed } = foregroundState(text, pkg);
  const focused = focusedPackage(text);
  if (state !== 'front') return { state, resumed, focused, why: state === 'unknown' ? 'nothing readable' : `${resumed} is resumed` };
  if (focused && focused !== pkg && !FOCUS_OVERLAY_PACKAGES.includes(focused)) return { state: 'background', resumed, focused, why: `${focused} holds the input focus while ${resumed} is resumed` };
  return { state: 'front', resumed, focused, why: 'resumed and focused' };
}

/**
 * Waits until the app is in front (inFrontState), bringing its EXISTING task to the front when it is not: first the launcher intent (bringToFrontCommand), and when that left the focus
 * where it was (the task was already the resumed one, so Android had nothing to move), HOME then the launcher intent - a real switch that hands the focus to the app's window. Bounded
 * (`tries`), each try waits on the condition (polls every `pollMs` up to `settleMs`), never on a fixed time alone. Logs ONE "EVIDENCE" line with the outcome when `evidence` is set or a
 * fix was needed. Never throws: a failing shell command counts as an unreadable answer.
 * @param {{ probe: () => string, run: (cmd: string) => unknown, pkg: string, why: string, log?: (message: string) => void, sleep: (ms: number) => Promise<unknown>,
 *   tries?: number, settleMs?: number, pollMs?: number, evidence?: boolean }} options
 * @returns {Promise<{ ok: boolean, fixes: number, verdict: ReturnType<typeof inFrontState> }>}
 */
export async function waitInFront({ probe, run, pkg, why, log = () => {}, sleep, tries = 3, settleMs = 6000, pollMs = 500, evidence = false }) {
  const read = () => {
    try {
      return inFrontState(probe(), pkg);
    } catch {
      return { state: 'unknown', resumed: null, focused: null, why: 'the probe failed' };
    }
  };
  let verdict = read();
  const first = verdict;
  let fixes = 0;
  while (verdict.state === 'background' && fixes < tries) {
    const viaHome = fixes > 0; // the plain launcher intent was tried and the focus did not move
    fixes++;
    try {
      if (viaHome) run('input keyevent KEYCODE_HOME');
      run(bringToFrontCommand(pkg));
    } catch {
      /* the read below says whether it helped */
    }
    for (let waited = 0; waited < settleMs; waited += pollMs) {
      await sleep(pollMs);
      verdict = read();
      if (verdict.state !== 'background') break;
    }
  }
  const ok = verdict.state !== 'background';
  if (evidence || fixes > 0) {
    const fixText = fixes === 0 ? 'nothing to fix' : `${fixes} bring-to-front(s)${fixes > 1 ? ' (the later ones via HOME)' : ''}`;
    log(
      `  EVIDENCE in front before ${why}: ${ok ? 'yes' : 'NO'} (${verdict.why}; resumed ${verdict.resumed ?? '?'}, focus ${verdict.focused ?? '?'}); at first: ${first.why} (focus ${first.focused ?? '?'}); ${fixText}`,
    );
  }
  return { ok, fixes, verdict };
}
