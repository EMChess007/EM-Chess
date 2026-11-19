#!/usr/bin/env bash
# Builds the APK the Android end-to-end run installs: `expo prebuild` + Gradle, x86_64 only (the CI emulator's ABI). No EAS, no account, no secret.
#
#   bash scripts/android/build-apk.sh <output dir>            RELEASE mode (command #46, what CI uses): writes <output dir>/app-e2e.apk
#   bash scripts/android/build-apk.sh <output dir> --debug    DEBUG mode (command #29, for local debugging): writes <output dir>/app-e2e.apk, needs Metro (scripts/android/metro.sh)
#
# RELEASE mode: the JavaScript bundle is built (minified, Hermes bytecode, __DEV__ false) and EMBEDDED in the APK, so there is no Metro at run time and a tap is not answered by a development
# server. Signed with the template's debug keystore (the emulator takes nothing else). apiBaseUrl.ts sends a release build to the deployed backend unless the build-time switch below is on, so
# THIS script (and nothing else: not a workflow `env`, not eas.json / app.json / .env*, CHECKLIST section 7) sets, on the Gradle process only:
#   EXPO_PUBLIC_E2E_BUILD=1   the ONE test switch: opens the gate (__DEV__ || the switch) of src/dev/registerE2e.ts, the state beacon, the quiet clocks and the API URL override
#   EXPO_PUBLIC_E2E=1         the probes and the quiet clocks (as scripts/android/metro.sh sets it)
#   EXPO_PUBLIC_API_URL       the run's backend at the emulator's host address
#   EXPO_PUBLIC_E2E_BEACON    where the boards tell the driver their state
# A production / EAS bundle is built without any of them and contains none of it (src/logic/__tests__/e2eBuildSwitch.test.ts exports a bundle and proves it).
# The release APK also gets `usesCleartextTraffic` (scripts/android/patch-cleartext.mjs): the backend of the run speaks plain http, which a debug build is allowed to and a release build is not.
#
# DEBUG mode: loads its JavaScript from Metro, so the APK only changes with the native side; the test URL comes from Metro's own process (metro.sh).
set -euo pipefail

out="${1:?usage: build-apk.sh <output dir> [--debug]}"
mode="release"
case "${2:-}" in
  "") ;;
  --debug) mode="debug" ;;
  *) echo "usage: build-apk.sh <output dir> [--debug]" >&2; exit 2 ;;
esac
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# the Sentry Gradle plugin would upload symbols to sentry.io at build time: there is no token here, and nothing may leave the runner
export SENTRY_DISABLE_AUTO_UPLOAD=true
export SENTRY_ALLOW_FAILURE=true
export EXPO_NO_TELEMETRY=1
export CI=1

echo "[build-apk] mode: $mode"
echo "[build-apk] expo prebuild"
npx expo prebuild --platform android --no-install --clean

# the run can switch the window between edge-to-edge and the frame of the phone of command #26 (a Settings.Global flag, this APK only)
node scripts/android/patch-main-activity.mjs android/app/src/main/java/com/emchess/app/MainActivity.kt

mkdir -p "$out"
jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g"
if [ "$mode" = "release" ]; then
  node scripts/android/patch-cleartext.mjs android/app/src/main/AndroidManifest.xml
  echo "[build-apk] gradle assembleRelease (x86_64, JavaScript bundle embedded)"
  (cd android && env EXPO_PUBLIC_E2E_BUILD=1 EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_API_URL="http://10.0.2.2:3000" EXPO_PUBLIC_E2E_BEACON="http://10.0.2.2:8765" EXPO_PUBLIC_USE_ONLINE_BACKEND=false \
    ./gradlew assembleRelease -PreactNativeArchitectures=x86_64 --console=plain --no-daemon "-Dorg.gradle.jvmargs=$jvmargs")
  cp android/app/build/outputs/apk/release/app-release.apk "$out/app-e2e.apk"
else
  echo "[build-apk] gradle assembleDebug (x86_64)"
  (cd android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64 --console=plain --no-daemon "-Dorg.gradle.jvmargs=$jvmargs")
  cp android/app/build/outputs/apk/debug/app-debug.apk "$out/app-e2e.apk"
fi
ls -l "$out/app-e2e.apk"
