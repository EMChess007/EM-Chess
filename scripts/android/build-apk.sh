#!/usr/bin/env bash
# Builds the DEBUG APK the Android end-to-end run installs (command #29): `expo prebuild` + Gradle, x86_64 only (the CI emulator's ABI). No EAS, no account, no secret.
#
#   bash scripts/android/build-apk.sh <output dir>        (writes <output dir>/app-debug.apk)
#
# Why a debug build: apiBaseUrl.ts sends a RELEASE build to the deployed backend, always, and the run must talk to its own private one. A debug build loads its JavaScript from Metro
# (scripts/android/metro.sh), so the APK itself only changes when the native side does (a dependency, app.json, the icons): the workflow caches it on exactly those files.
set -euo pipefail

out="${1:?usage: build-apk.sh <output dir>}"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# the Sentry Gradle plugin would upload symbols to sentry.io at build time: there is no token here, and nothing may leave the runner
export SENTRY_DISABLE_AUTO_UPLOAD=true
export SENTRY_ALLOW_FAILURE=true
export EXPO_NO_TELEMETRY=1
export CI=1

echo "[build-apk] expo prebuild"
npx expo prebuild --platform android --no-install --clean

# the run can switch the window between edge-to-edge and the frame of the phone of command #26 (a Settings.Global flag, this APK only)
node scripts/android/patch-main-activity.mjs android/app/src/main/java/com/emchess/app/MainActivity.kt

echo "[build-apk] gradle assembleDebug (x86_64)"
(cd android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64 --console=plain --no-daemon -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g")

mkdir -p "$out"
cp android/app/build/outputs/apk/debug/app-debug.apk "$out/app-debug.apk"
ls -l "$out/app-debug.apk"
