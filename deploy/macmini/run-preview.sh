#!/bin/zsh
set -euo pipefail

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
APP_DIR="${OPSCENTER_PREVIEW_APP_DIR:-$EXPECTED_HOME/opscenter-v2/opscenter-preview}"
DATA_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/data"
ENV_FILE="$EXPECTED_HOME/Library/Application Support/OpsCenter/macmini-preview.env"
PORT="3100"
HOST="127.0.0.1"
LOCK_DIR="/tmp/com.openclaw.opscenter.macmini-preview.lock"
LOG_PREFIX="[macmini-preview]"

load_environment_file() {
  local file="$1"
  local config_line
  while IFS= read -r config_line || [[ -n "$config_line" ]]; do
    [[ -z "$config_line" || "$config_line" == \#* ]] && continue
    [[ "$config_line" =~ '^[A-Za-z_][A-Za-z0-9_]*=' ]] || {
      echo "$LOG_PREFIX invalid environment entry in $file" >&2
      return 1
    }
    export "$config_line"
  done < "$file"
}

if [[ "$(id -un)" != "$EXPECTED_USER" || "$HOME" != "$EXPECTED_HOME" ]]; then
  echo "$LOG_PREFIX must run as $EXPECTED_USER with home $EXPECTED_HOME" >&2
  exit 64
fi

[[ -d "$APP_DIR" ]] || { echo "$LOG_PREFIX missing app directory: $APP_DIR" >&2; exit 66; }
[[ -d "$DATA_DIR" ]] || { echo "$LOG_PREFIX missing preview data: $DATA_DIR" >&2; exit 66; }
[[ -f "$ENV_FILE" ]] || { echo "$LOG_PREFIX missing preview environment: $ENV_FILE" >&2; exit 66; }

load_environment_file "$ENV_FILE"

# The desktop street map uses the same server-side tile integration in preview.
# Load only its existing Keychain entry; other production integration secrets
# remain outside this preview wrapper and no value is written to an env file.
if [[ -z "${GOOGLE_MAPS_API_KEY:-}" ]]; then
  preview_google_key="$(/usr/bin/security find-generic-password \
    -a opscenter -s com.opscenter.google-maps-api-key -w 2>/dev/null)" || preview_google_key=""
  if [[ -z "$preview_google_key" ]]; then
    # Some installations retain this one map credential in production.env.
    # Parse only its literal value; never source production configuration.
    preview_google_key="$(python3 - "$EXPECTED_HOME/Library/Application Support/OpsCenter/production.env" <<'PYKEY'
import pathlib, sys
try:
    for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
        if line.startswith('GOOGLE_MAPS_API_KEY='):
            value = line.partition('=')[2].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            print(value, end='')
            break
except OSError:
    pass
PYKEY
)" || preview_google_key=""
  fi
  [[ -z "$preview_google_key" ]] || export GOOGLE_MAPS_API_KEY="$preview_google_key"
  unset preview_google_key
fi

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
