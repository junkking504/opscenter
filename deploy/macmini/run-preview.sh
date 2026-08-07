#!/bin/zsh
set -euo pipefail

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
DATA_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/data"
ENV_FILE="$EXPECTED_HOME/Library/Application Support/OpsCenter/macmini-preview.env"
PORT="3100"
HOST="127.0.0.1"
LOCK_DIR="/tmp/com.openclaw.opscenter.macmini-preview.lock"
LOG_PREFIX="[macmini-preview]"

if [[ "$(id -un)" != "$EXPECTED_USER" || "$HOME" != "$EXPECTED_HOME" ]]; then
  echo "$LOG_PREFIX must run as $EXPECTED_USER with home $EXPECTED_HOME" >&2
  exit 64
fi

[[ -d "$APP_DIR" ]] || { echo "$LOG_PREFIX missing app directory: $APP_DIR" >&2; exit 66; }
[[ -d "$DATA_DIR" ]] || { echo "$LOG_PREFIX missing preview data: $DATA_DIR" >&2; exit 66; }
[[ -f "$ENV_FILE" ]] || { echo "$LOG_PREFIX missing preview environment: $ENV_FILE" >&2; exit 66; }

set -a
source "$ENV_FILE"
set +a

mkdir -p "$APP_DIR/logs"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "$LOG_PREFIX preview is already listening on port $PORT" >&2
    exit 75
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || {
    echo "$LOG_PREFIX stale non-empty lock requires inspection: $LOCK_DIR" >&2
    exit 75
  }
  mkdir "$LOCK_DIR"
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$APP_DIR"
export NODE_ENV="production"
export HOSTNAME="$HOST"
export PORT="$PORT"
export OPSCENTER_RUNTIME="MAC_MINI_PREVIEW"
export OPSBOT_DATA_DIR="$DATA_DIR"
export NEXT_DIST_DIR="tmp/macmini-preview-next"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "$LOG_PREFIX port $PORT is already in use" >&2
  exit 75
fi

exec ./node_modules/.bin/next start -H "$HOST" -p "$PORT"
