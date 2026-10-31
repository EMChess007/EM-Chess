#!/usr/bin/env bash
# Metro for the Android end-to-end run (command #29): serves the app's JavaScript to the debug APK in development mode, pointed at the run's own backend.
#
#   bash scripts/android/metro.sh start | stop
#
# The two EXPO_PUBLIC_ variables are test-only switches (CHECKLIST section 7) and are set HERE, on Metro's own process, never in a workflow `env` or a checked-in .env:
#   EXPO_PUBLIC_API_URL  the backend the emulator reaches at the host's address 10.0.2.2 (apiBaseUrl.ts honours it in a development build only, and accepts nothing but a plain http(s) origin)
#   EXPO_PUBLIC_E2E      hides the development build's warning toasts (src/dev/registerE2e.ts; development build only)
#   EXPO_PUBLIC_E2E_BEACON  where the boards tell the driver their state (src/dev/e2eBeacon.ts, command #30): a plain http origin on 10.0.2.2 / localhost with a port, development build only
#   (the driver, scripts/android/e2e.mjs, listens on that port on the runner)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
state="${ANDROID_E2E_STATE:-${RUNNER_TEMP:-/tmp}/android-e2e-state}"
mkdir -p "$state"
pidfile="$state/metro.pid"
port=8081

case "${1:-}" in
  start)
    if curl -sf "http://localhost:$port/status" >/dev/null 2>&1; then
      echo "[metro] port $port is already served by something else: refusing to start" >&2
      exit 1
    fi
    EXPO_PUBLIC_API_URL="http://10.0.2.2:3000" EXPO_PUBLIC_E2E=1 EXPO_PUBLIC_E2E_BEACON="http://10.0.2.2:8765"EXPO_PUBLIC_USE_ONLINE_BACKEND=false EXPO_NO_TELEMETRY=1 CI=1 \
      nohup npx expo start --port "$port" --offline > "$state/metro.log" 2>&1 &
    echo $! > "$pidfile"
    for _ in $(seq 1 120); do
      if curl -sf "http://localhost:$port/status" 2>/dev/null | grep -q "packager-status:running"; then
        echo "[metro] running on $port (pid $(cat "$pidfile"))"
        exit 0
      fi
      sleep 1
    done
    echo "[metro] did not start; its log:" >&2
    tail -n 40 "$state/metro.log" >&2 || true
    exit 1
    ;;
  stop)
    if [ -f "$pidfile" ]; then
      pid="$(cat "$pidfile")"
      # only the process this script started, with its children
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
      rm -f "$pidfile"
    fi
    ;;
  *)
    echo "usage: metro.sh start | stop" >&2
    exit 2
    ;;
esac
