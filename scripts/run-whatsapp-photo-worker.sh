#!/bin/zsh
set -euo pipefail

USER_HOME="${HOME:?HOME must be set}"
APP_DIR="${OPSCENTER_APP_DIR:-$USER_HOME/opscenter-v2/opscenter}"
ENV_FILE="${OPSCENTER_ENV_FILE:-}"
SLACK_ENV_FILE="${OPSCENTER_SLACK_ENV_FILE:-$USER_HOME/Library/Application Support/OpsCenter/slack.env}"
LOCK_DIR="/tmp/com.openclaw.opscenter.whatsapp-photos.lock"
PID_FILE="$LOCK_DIR/pid"
LOG_PREFIX="[whatsapp-photo-worker]"

if [[ -n "$ENV_FILE" ]]; then
  [[ -f "$ENV_FILE" ]] || {
    echo "$LOG_PREFIX missing environment file: $ENV_FILE" >&2
    exit 66
  }
  set -a
  source "$ENV_FILE"
  set +a
fi

if [[ -f "$SLACK_ENV_FILE" ]]; then
  set -a
  source "$SLACK_ENV_FILE"
  set +a
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  existing_pid=""
  [[ -f "$PID_FILE" ]] && existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$existing_pid" == <-> ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "$LOG_PREFIX existing worker is still running as pid $existing_pid" >&2
    exit 75
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
export OPSBOT_DATA_DIR="${OPSBOT_DATA_DIR:-$USER_HOME/.openclaw/workspace/opsbot/data}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

while true; do
  if ! ./node_modules/.bin/tsx scripts/process-whatsapp-job-photos.ts; then
    echo "$LOG_PREFIX processing cycle failed; retrying in 30 seconds" >&2
    sleep 30
  else
    sleep 5
  fi
done
