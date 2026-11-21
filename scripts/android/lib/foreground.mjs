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
