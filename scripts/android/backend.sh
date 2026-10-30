#!/usr/bin/env bash
# The run's own backend and the Bughouse buddy for the Android end-to-end run (command #29).
#
#   bash scripts/android/backend.sh start | stop
#
# Needs: ./backend (the chess-app-backend checkout), a PostgreSQL on localhost:5432 with the role / database below (the workflow's service container, TEST-ONLY values the same as
# backend/docker-compose.yml), `npm ci` done in ./backend. Starts the server on port 3000 (the emulator reaches it at 10.0.2.2:3000) and the buddy: a second HUMAN socket that queues
# for a 1 minute Bughouse game and plays random legal moves, because a queue of one human waits for ever by design (the bots fill the empty seats only once two humans wait).
# No test-only server switch is set: the server runs with its normal limits. `stop` kills only the two processes this script started.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../backend"
state="${ANDROID_E2E_STATE:-${RUNNER_TEMP:-/tmp}/android-e2e-state}"
mkdir -p "$state"
tsx="node node_modules/tsx/dist/cli.mjs"

stop_one() {
  local file="$1"
  if [ -f "$file" ]; then
    local pid
    pid="$(cat "$file")"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    rm -f "$file"
  fi
}

case "${1:-}" in
  start)
    if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
      echo "[backend] port 3000 already answers: refusing to start a second server" >&2
      exit 1
    fi
    export DATABASE_URL="${DATABASE_URL:-postgresql://chess:chess@localhost:5432/chess_app}"
    export JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
    export PORT=3000
    # a throw-away database on this machine only
    case "$DATABASE_URL" in
      *@localhost:*|*@127.0.0.1:*) ;;
      *) echo "[backend] DATABASE_URL is not local: refusing" >&2; exit 1 ;;
    esac
    npx prisma generate >/dev/null
    npx prisma migrate deploy >/dev/null
    nohup $tsx src/index.ts > "$state/backend.log" 2>&1 &
    echo $! > "$state/backend.pid"
    for _ in $(seq 1 90); do
      if curl -sf http://localhost:3000/health >/dev/null 2>&1; then break; fi
      sleep 1
    done
    curl -sf http://localhost:3000/health >/dev/null || { echo "[backend] did not start; its log:" >&2; tail -n 40 "$state/backend.log" >&2; exit 1; }
    echo "[backend] up (pid $(cat "$state/backend.pid"))"
    BACKEND_URL=http://localhost:3000 TIME_CONTROL=1 nohup $tsx scripts/bughouse-buddy.mjs > "$state/buddy.log" 2>&1 &
    echo $! > "$state/buddy.pid"
    sleep 3
    echo "[backend] buddy started (pid $(cat "$state/buddy.pid")); its first lines:"
    head -n 3 "$state/buddy.log" || true
    ;;
  stop)
    stop_one "$state/buddy.pid"
    stop_one "$state/backend.pid"
    echo "[backend] stopped"
    ;;
  *)
    echo "usage: backend.sh start | stop" >&2
    exit 2
    ;;
esac
