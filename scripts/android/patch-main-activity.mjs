#!/usr/bin/env node
/**
 * The end-to-end APK only (command #30; run by scripts/android/build-apk.sh on the GENERATED android project, never on anything that is committed): lets the run switch the app's window between
 * edge-to-edge (what the emulator does) and the frame of the phone that showed the touch bug of command #26 (the app's root view sits BELOW the status bar, so the window frame and the root
 * frame differ by the status bar's height).
 *
 *   adb shell settings put global em_e2e_fit_system_windows 1     then restart the app: the decor view fits the system bars
 *   adb shell settings put global em_e2e_fit_system_windows 0     (or delete it): the app's own window, edge-to-edge
 *
 * Why this and not a theme: the emulator is Android 14 (API 34), where nothing enforces edge-to-edge, and the app's frames coincide - which is why the reverted touch fix of #26 still passed
 * the first emulator run. A runtime switch lets ONE APK be checked in both frames. The setting is a Settings.Global value, readable by any app, and exists only in this APK.
 * Idempotent; `--check <file>` exits 1 when the file is not patched.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MARK = 'em_e2e_fit_system_windows';
const ANCHOR = '    super.onCreate(null)\n';
const PATCH = `${ANCHOR}    // END-TO-END BUILD ONLY (scripts/android/patch-main-activity.mjs): the run asks for the window frame of a phone whose status bar is not drawn under the app.
    if (android.provider.Settings.Global.getInt(contentResolver, "${MARK}", 0) == 1) {
      androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, true)
    }
`;

export function patch(source) {
  if (source.includes(MARK)) return source;
  if (!source.includes(ANCHOR)) throw new Error('MainActivity.kt has no "super.onCreate(null)" line: the template changed, update patch-main-activity.mjs');
  return source.replace(ANCHOR, PATCH);
}

if (process.argv[1] && process.argv[1].endsWith('patch-main-activity.mjs')) {
  const check = process.argv[2] === '--check';
  const file = check ? process.argv[3] : process.argv[2];
  if (!file) {
    console.error('usage: patch-main-activity.mjs [--check] <MainActivity.kt>');
    process.exit(2);
  }
  const source = readFileSync(file, 'utf8');
  if (check) process.exit(source.includes(MARK) ? 0 : 1);
  writeFileSync(file, patch(source));
  console.log(`[patch-main-activity] ${file} patched`);
}
