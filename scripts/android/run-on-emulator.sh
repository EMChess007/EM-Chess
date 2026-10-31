#!/usr/bin/env bash
# Everything that runs WHILE the emulator is up (command #29, split into parallel jobs by command #30; the workflow's emulator step calls this one file, because that action runs its
# `script:` lines one by one in separate shells).
#
#   bash scripts/android/run-on-emulator.sh <apk> <output dir> <job>
#
# <job> is one slice of the run; the workflow starts them side by side, each on its own emulator, so the wall time is the slowest slice and not the sum (36 - 40 minutes in one job):
#   small-screens-1 | small-screens-2   the core screens on the cramped phone (360 x 640 dp at font scale 1.3), every other screen of the list each
#   small-gallery                       the on-device text-fit probe and the Piece gallery pixels (the gallery does not depend on the window: the cramped phone runs it)
#   large-screens-1 | large-screens-2   the board and tab screens on the large phone (the emulator's own screen, font scale 1.0)
#   large-touch                         the text-fit probe, real touches on the 2-player board and on both Bughouse boards - edge-to-edge and in the frame of the phone of command #26
#   online                              the backend + the buddies: register, sign in, spectate, the online Bughouse game, then the backend STOPPED and the offline states (cramped phone)
#   all                                 every slice, one after the other (a local run)
# A failing slice never stops the later ones; the exit code is non-zero if any failed.
set -uo pipefail

apk="${1:?usage: run-on-emulator.sh <apk> <output dir> <job>}"
out="${2:?usage: run-on-emulator.sh <apk> <output dir> <job>}"
job="${3:-all}"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
mkdir -p "$out"

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
adb shell input keyevent 82 || true   # wake the screen
adb shell settings put secure show_ime_with_hard_keyboard 0 || true
adb shell settings put secure immersive_mode_confirmations confirmed || true   # no "Viewing full screen" notice over the app (the driver also taps "Got it")
adb shell settings put global em_e2e_fit_system_windows 0 || true              # edge-to-edge unless a check asks for the phone's frame (scripts/android/patch-main-activity.mjs)
adb install -r -g "$apk"
adb reverse tcp:8081 tcp:8081
adb logcat -c || true
echo "[run] job $job on: $(adb shell getprop ro.product.model | tr -d '\r') Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r'))"

node scripts/android/smoke.mjs "$out" || { echo "[run] the app did not reach its Home screen: stopping here"; exit 1; }

rc=0
phase() {
  local profile="$1" name="$2" tag="$3"
  shift 3
  local t0=$SECONDS
  echo "::group::android-e2e $profile $name $tag"
  node scripts/android/e2e.mjs --profile "$profile" --phase "$name" --tag "$tag" --out "$out" ${ANDROID_E2E_ALL:+--all} "$@" || rc=1
  echo "::endgroup::"
  echo "[run] $profile/$name/$tag took $((SECONDS - t0)) s"
}

online() {
  # the backend and the buddy; the phase stops the backend itself after signing in again, then checks the offline states
  bash scripts/android/backend.sh start || { echo "[run] the backend could not start"; rc=1; }
  phase small online online
  bash scripts/android/backend.sh stop || true
}

case "$job" in
  small-screens-1) phase small static screens1 --parts screens --shard 1/2 ;;
  small-screens-2) phase small static screens2 --parts screens --shard 2/2 ;;
  small-gallery) phase small static gallery --parts textfit,gallery ;;
  large-screens-1) phase large static screens1 --parts screens --shard 1/2 ;;
  large-screens-2) phase large static screens2 --parts screens --shard 2/2 ;;
  large-touch) phase large static touch --parts textfit,touch2p,touchbug,touchinset ;;
  online) online ;;
  all)
    phase small static screens1 --parts screens --shard 1/2
    phase small static screens2 --parts screens --shard 2/2
    phase small static gallery --parts textfit,gallery
    phase large static screens1 --parts screens --shard 1/2
    phase large static screens2 --parts screens --shard 2/2
    phase large static touch --parts textfit,touch2p,touchbug,touchinset
    online
    ;;
  *) echo "[run] unknown job '$job'" >&2; exit 2 ;;
esac

cp "${ANDROID_E2E_STATE:-${RUNNER_TEMP:-/tmp}/android-e2e-state}"/*.log "$out"/ 2>/dev/null || true
exit $rc
