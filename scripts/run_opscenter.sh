#!/bin/zsh
set -euo pipefail

USER_HOME="${HOME:?HOME must be set}"
APP_DIR="${OPSCENTER_APP_DIR:-$USER_HOME/opscenter-v2/opscenter}"
PORT="${PORT:-3000}"
HOST="${OPSCENTER_HOST:-127.0.0.1}"
LOCK_DIR="/tmp/com.openclaw.opscenter.lock"
PID_FILE="$LOCK_DIR/pid"
LOG_PREFIX="[run_opscenter]"

mkdir -p "$APP_DIR/logs"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -f "$PID_FILE" ]]; then
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
      echo "$LOG_PREFIX existing OpsCenter wrapper still running as pid $existing_pid; refusing duplicate start" >&2
      exit 75
    fi
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi

print $$ > "$PID_FILE"
cleanup() {
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

cd "$APP_DIR"
export NODE_ENV=production
export HOSTNAME="$HOST"
export PORT="$PORT"
if [[ "$(id -un)" == "missioncontrol" ]]; then
  export OPSCENTER_RUNTIME="MISSION_CONTROL"
else
  export OPSCENTER_RUNTIME="${OPSCENTER_RUNTIME:-LIVE}"
fi
export OPSBOT_DATA_DIR="${OPSBOT_DATA_DIR:-$USER_HOME/.openclaw/workspace/opsbot/data}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "$LOG_PREFIX port $PORT is already listening before start; refusing duplicate Next.js process" >&2
  exit 75
fi

exec ./node_modules/.bin/next start -H "$HOST" -p "$PORT"
