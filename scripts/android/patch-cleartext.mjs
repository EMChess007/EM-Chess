#!/usr/bin/env node
/**
 * The RELEASE-mode end-to-end APK only (command #46; run by scripts/android/build-apk.sh on the GENERATED android project, never on anything that is committed): lets the app reach the run's own
 * backend, which speaks plain http at 10.0.2.2:3000. A debug build gets `usesCleartextTraffic` from the template's src/debug manifest; a release build has none, so Android would refuse every request.
 * The attribute is added to the MAIN manifest of the generated project, i.e. to this APK only: app.json, eas.json and the production build are untouched (a test pins that).
 * Idempotent; `--check <file>` exits 1 when the file is not patched.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MARK = 'android:usesCleartextTraffic="true"';
const ANCHOR = '<application ';

export function patch(source) {
  if (source.includes(MARK)) return source;
  if (!source.includes(ANCHOR)) throw new Error('AndroidManifest.xml has no "<application " element: the template changed, update patch-cleartext.mjs');
  return source.replace(ANCHOR, `${ANCHOR}${MARK} `);
}

if (process.argv[1] && process.argv[1].endsWith('patch-cleartext.mjs')) {
  const check = process.argv[2] === '--check';
  const file = check ? process.argv[3] : process.argv[2];
  if (!file) {
    console.error('usage: patch-cleartext.mjs [--check] <AndroidManifest.xml>');
    process.exit(2);
  }
  const source = readFileSync(file, 'utf8');
  if (check) process.exit(source.includes(MARK) ? 0 : 1);
  writeFileSync(file, patch(source));
  console.log(`[patch-cleartext] ${file} patched`);
}
