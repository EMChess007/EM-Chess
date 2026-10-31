#!/usr/bin/env bash
# Cloud-session setup for EM-Chess (the app) + chess-app-backend (the server): everything every gate in TESTING.md needs, on an Ubuntu VM.
#
#   bash scripts/cloud-setup.sh            (idempotent: a second run only starts what is not running; ~10 s when everything is in place)
#
# What it does, in order (TESTING.md, "Cloud sessions"):
#   1. Node 22 (the version CI runs on) from /opt/node22, put first on PATH for this run and for every later login shell.
#   2. The repo layout the scripts expect: the backend lives INSIDE the app checkout as <app>/backend (the app's .gitignore lists /backend), because
#      the backend's test scripts import ../../src/... of the app. It is moved there (with a symlink left at the old path) or cloned.
#   3. PostgreSQL 16 (the major of backend/docker-compose.yml), native: Docker Hub is rate limited from the cloud (HTTP 429), so docker compose cannot pull it.
#      The role, password and database are the ones docker-compose.yml and .env.example describe (chess / chess / chess_app).
#   4. backend/.env with TEST-ONLY values (the local database, a random JWT_SECRET). It never reads, asks for or prints a real .env, Neon or Render secret.
#   5. npm ci in both repos (skipped when package-lock.json and the Node version are unchanged), prisma generate + migrate deploy.
#
# Safe to re-run; it never overwrites an existing backend/.env, never touches a backend checkout that already exists (only a fresh clone is switched to a
# branch) and never prints a secret. Exit code non-zero = a step failed (the message says which).
#
# Settings (all optional, none secret):
#   CLOUD_APP_DIR        the app checkout (default: the folder above this script; set it when running a copy of the script from elsewhere)
#   CLOUD_BACKEND_REPO   git URL of the backend      (default https://github.com/EMChess007/chess-app-backend.git)
#   CLOUD_BACKEND_REF    branch a FRESH clone checks out (default: the app's branch when it is paired/<x> and the backend has it, else the default branch)
#   CLOUD_NODE_MAJOR     Node major to use            (default 22, as .github/workflows/ci.yml; Expo SDK 58 / React Native 0.88 need Node >= 22.13)
#   CLOUD_SKIP_NPM=1     skip npm ci (layout / database only)
#   CLOUD_SKIP_DB=1      skip PostgreSQL, .env and Prisma

set -euo pipefail

started=$(date +%s)
say() { printf '[cloud-setup] %s\n' "$*"; }
die() { printf '[cloud-setup] FAILED: %s\n' "$*" >&2; exit 1; }

APP_DIR="$(cd "${CLOUD_APP_DIR:-$(dirname "${BASH_SOURCE[0]}")/..}" && pwd -P)"
BACKEND_DIR="$APP_DIR/backend"
BACKEND_REPO="${CLOUD_BACKEND_REPO:-https://github.com/EMChess007/chess-app-backend.git}"
NODE_MAJOR="${CLOUD_NODE_MAJOR:-22}"
PG_MAJOR=16
DB_USER=chess
DB_PASSWORD=chess
DB_NAME=chess_app

[ "$(uname -s)" = "Linux" ] || die "this script is for the Linux cloud VM (on Windows follow TESTING.md, the local sections)"
[ -f "$APP_DIR/package.json" ] && [ -d "$APP_DIR/.git" ] || die "$APP_DIR is not the app checkout"

as_root() { if [ "$(id -u)" = "0" ]; then "$@"; else sudo "$@"; fi; }

# --- 1. Node ------------------------------------------------------------------------------------------------------------------------------------------------
NODE_DIR="/opt/node${NODE_MAJOR}"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  say "installing Node $NODE_MAJOR into $NODE_DIR (not pre-installed)"
  tmp="$(mktemp -d)"
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  file="$(curl -fsS "$base/SHASUMS256.txt" | awk '/linux-x64\.tar\.xz$/ {print $2}')"
  [ -n "$file" ] || die "no linux-x64 Node $NODE_MAJOR build listed at $base"
  curl -fsS -o "$tmp/$file" "$base/$file"
  (cd "$tmp" && curl -fsS "$base/SHASUMS256.txt" | grep " $file\$" | sha256sum -c - >/dev/null) || die "checksum of $file does not match"
  as_root mkdir -p "$NODE_DIR"
  as_root tar -xJf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
fi
export PATH="$NODE_DIR/bin:$PATH"
# Every later login shell (the session's shell) gets the same Node (the VM's default is 22, CI runs 22), the browser the end-to-end suite uses (Playwright's Chromium, there is no
# system Chrome: backend scripts/e2e-browser reads E2E_BROWSER_PATH) and no Expo telemetry (the cloud proxy refuses cdp.expo.dev and the export only complains). None of it is secret.
profile=/etc/profile.d/zz-em-chess.sh
want="export PATH=\"$NODE_DIR/bin:\$PATH\"
export EXPO_NO_TELEMETRY=1"
if [ -x /opt/pw-browsers/chromium ]; then want="$want
export E2E_BROWSER_PATH=/opt/pw-browsers/chromium"; fi
if [ "$(cat "$profile" 2>/dev/null)" != "$want" ]; then
  printf '%s\n' "$want" | as_root tee "$profile" >/dev/null
fi
as_root rm -f /etc/profile.d/zz-em-chess-node.sh # the name of the first version of this file
say "node $(node -v), npm $(npm -v)"

# --- 2. the backend inside the app checkout ----------------------------------------------------------------------------------------------------------------
SIBLING="$(dirname "$APP_DIR")/chess-app-backend"
if [ -d "$BACKEND_DIR/.git" ]; then
  say "backend already at $BACKEND_DIR ($(git -C "$BACKEND_DIR" rev-parse --abbrev-ref HEAD) @ $(git -C "$BACKEND_DIR" rev-parse --short HEAD))"
elif [ -d "$SIBLING/.git" ] && [ ! -L "$SIBLING" ]; then
  # The environment's "Repositories" list attached it next to the app: move it inside (the scripts need the nested layout) and leave a symlink behind.
  say "moving the attached backend $SIBLING -> $BACKEND_DIR (symlink left at the old path)"
  mv "$SIBLING" "$BACKEND_DIR"
  ln -s "$BACKEND_DIR" "$SIBLING"
else
  say "cloning the backend into $BACKEND_DIR"
  ref="${CLOUD_BACKEND_REF:-}"
  if [ -z "$ref" ]; then
    app_branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
    case "$app_branch" in
      paired/?*) if git ls-remote --exit-code --heads "$BACKEND_REPO" "refs/heads/$app_branch" >/dev/null 2>&1; then ref="$app_branch"; fi ;;
    esac
  fi
  git clone "$BACKEND_REPO" "$BACKEND_DIR" || die "cannot clone $BACKEND_REPO. Add the repository under 'Repositories' in the cloud environment settings and start a new session"
  if [ -n "$ref" ]; then git -C "$BACKEND_DIR" checkout "$ref"; fi
  [ -e "$SIBLING" ] || ln -s "$BACKEND_DIR" "$SIBLING"
fi
[ -f "$BACKEND_DIR/package.json" ] || die "$BACKEND_DIR has no package.json"

# --- 3. npm ci (both repos, in parallel; skipped when nothing changed) ------------------------------------------------------------------------------------------
npm_ci() {
  local dir="$1" stamp key
  stamp="$dir/node_modules/.cloud-setup-stamp"
  key="$(sha256sum "$dir/package-lock.json" | cut -d' ' -f1)-node$(node -v)"
  if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$key" ]; then
    say "npm ci skipped in $dir (lockfile and Node unchanged)"
    return 0
  fi
  say "npm ci in $dir"
  (cd "$dir" && npm ci --no-audit --no-fund --loglevel=error) || return 1
  printf '%s' "$key" > "$stamp"
}
if [ "${CLOUD_SKIP_NPM:-}" != "1" ]; then
  npm_ci "$APP_DIR" & pid_app=$!
  npm_ci "$BACKEND_DIR" & pid_back=$!
  rc=0
  wait "$pid_app" || rc=1
  wait "$pid_back" || rc=1
  [ "$rc" = "0" ] || die "npm ci failed (see above)"
fi

# --- 4. PostgreSQL --------------------------------------------------------------------------------------------------------------------------------------------
if [ "${CLOUD_SKIP_DB:-}" = "1" ]; then
  say "CLOUD_SKIP_DB=1: no database, .env or Prisma"
  say "done in $(( $(date +%s) - started )) s"
  exit 0
fi

if ! command -v pg_ctlcluster >/dev/null 2>&1 || [ ! -x "/usr/lib/postgresql/$PG_MAJOR/bin/postgres" ]; then
  say "installing PostgreSQL $PG_MAJOR"
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "postgresql-$PG_MAJOR" >/dev/null || {
    as_root apt-get update -qq >/dev/null
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "postgresql-$PG_MAJOR" >/dev/null
  } || die "cannot install postgresql-$PG_MAJOR"
fi
pg_lsclusters -h 2>/dev/null | awk '{print $1 "/" $2}' | grep -qx "$PG_MAJOR/main" || as_root pg_createcluster "$PG_MAJOR" main
if ! as_root pg_lsclusters -h | awk -v v="$PG_MAJOR" '$1 == v && $2 == "main" && $4 == "online" {found = 1} END {exit !found}'; then
  say "starting the local PostgreSQL cluster $PG_MAJOR/main"
  as_root pg_ctlcluster "$PG_MAJOR" main start
fi
for _ in $(seq 1 30); do pg_isready -q -h 127.0.0.1 -p 5432 && break; sleep 1; done
pg_isready -q -h 127.0.0.1 -p 5432 || die "PostgreSQL does not answer on 127.0.0.1:5432"

# Same as the docker image: the POSTGRES_USER is a superuser. A local, empty, test-only database.
psql_admin() { as_root runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qtA "$@"; }
if [ "$(psql_admin -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'")" != "1" ]; then
  psql_admin -c "CREATE ROLE $DB_USER LOGIN SUPERUSER PASSWORD '$DB_PASSWORD'"
fi
if [ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" != "1" ]; then
  psql_admin -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
fi

# --- 5. backend/.env (test-only values) ---------------------------------------------------------------------------------------------------------------------
LOCAL_DB_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
if [ -f "$BACKEND_DIR/.env" ]; then
  # Never trust or keep a file that points anywhere but the local database. The value is not printed.
  if ! grep -Eq '^DATABASE_URL="?postgres(ql)?://[^@/]*@(localhost|127\.0\.0\.1)[:/]' "$BACKEND_DIR/.env"; then
    die "$BACKEND_DIR/.env does not point at the local database: remove it and run this script again (nothing was changed)"
  fi
  say "backend/.env already present (local database), left as is"
else
  umask 077
  {
    printf 'DATABASE_URL="%s"\n' "$LOCAL_DB_URL"
    printf 'JWT_SECRET="%s"\n' "$(openssl rand -hex 32)"
    printf 'PORT=3000\n'
  } > "$BACKEND_DIR/.env"
  say "wrote backend/.env (local database URL, random JWT_SECRET; not committed: .env is in the backend's .gitignore)"
fi
git -C "$BACKEND_DIR" check-ignore -q .env || die "backend/.env is not git-ignored: refusing to continue"

# --- 6. Prisma --------------------------------------------------------------------------------------------------------------------------------------------------
if [ "${CLOUD_SKIP_NPM:-}" != "1" ]; then
  (cd "$BACKEND_DIR" && set -a && . ./.env && set +a && npx prisma generate >/dev/null && npx prisma migrate deploy >/dev/null) || die "prisma generate / migrate deploy failed"
  accounts="$(PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -qtA -c 'SELECT count(*) FROM users' 2>/dev/null || echo '?')"
  say "prisma client generated, migrations applied; local accounts: $accounts"
fi

say "app     $(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD) @ $(git -C "$APP_DIR" rev-parse --short HEAD)"
say "backend $(git -C "$BACKEND_DIR" rev-parse --abbrev-ref HEAD) @ $(git -C "$BACKEND_DIR" rev-parse --short HEAD)"
say "done in $(( $(date +%s) - started )) s"
