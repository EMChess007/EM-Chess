#!/usr/bin/env bash
# Everything that runs WHILE the emulator is up (command #29; the workflow's emulator step calls this one file, because that action runs its `script:` lines one by one in separate shells).
#
#   bash scripts/android/run-on-emulator.sh <apk> <output dir>
#
# Order matters: the first phases run with NO backend (nothing to reach: every screen, the text probe, the gallery, the touches), then the backend and the buddy start for the online game,
# then the backend is STOPPED for the offline phase, with the account of the online phase still signed in. Each phase runs on both profiles (small 360x640 dp at font scale 1.3, large at 1.0).
# A failing phase never stops the later ones; the exit code is non-zero if any failed.
set -uo pipefail

apk="${1:?usage: run-on-emulator.sh <apk> <output dir>}"
out="${2:?usage: run-on-emulator.sh <apk> <output dir>}"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mkdir -p "$out"

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
adb shell input keyevent 82 || true   # wake the screen
adb shell settings put secure show_ime_with_hard_keyboard 0 || true
adb shell settings put secure immersive_mode_confirmations confirmed || true   # no "Viewing full screen" notice over the app (the driver also taps "Got it")
adb install -r -g "$apk"
adb reverse tcp:8081 tcp:8081
adb logcat -c || true
echo "[run] device: $(adb shell getprop ro.product.model | tr -d '\r') Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r'))"

node scripts/android/smoke.mjs "$out" || { echo "[run] the app did not reach its Home screen: stopping here"; exit 1; }

rc=0
phase() {
  local profile="$1" name="$2"
  local t0=$SECONDS
  echo "::group::android-e2e $profile $name"
  node scripts/android/e2e.mjs --profile "$profile" --phase "$name" --out "$out" ${ANDROID_E2E_ALL:+--all} || rc=1
  echo "::endgroup::"
  echo "[run] $profile/$name took $((SECONDS - t0)) s"
}

for p in small large; do phase "$p" static; done

# The online game and the offline states run on the cramped phone only (the budget of the job is about 25 minutes; the layouts they exercise are the ones the static phase checks on both).
bash scripts/android/backend.sh start || { echo "[run] the backend could not start"; rc=1; }
phase small online   # (this phase stops the backend itself after signing in again, then checks the offline states)
bash scripts/android/backend.sh stop || true

cp "${ANDROID_E2E_STATE:-${RUNNER_TEMP:-/tmp}/android-e2e-state}"/*.log "$out"/ 2>/dev/null || true
exit $rc
