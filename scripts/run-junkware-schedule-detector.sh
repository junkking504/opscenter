#!/bin/bash
set -Eeuo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
DATE="${1:-$(TZ=America/Chicago date +%F)}"
LOCK_DIR="$OPSBOT_DIR/tmp/junkware_schedule_detector.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"

for ENV_FILE in "$OPSBOT_DIR/.env" "$OPSBOT_DIR/.env.local" "$USER_HOME/.openclaw/.env" "$OPSCENTER_DIR/.env.slack.local"; do
  if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
  fi
done

mkdir -p "$OPSBOT_DIR/tmp" "$OPSBOT_DIR/logs"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  prior_pid="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
  prior_command=""
  if [[ "$prior_pid" =~ ^[0-9]+$ ]]; then
    prior_command="$(ps -p "$prior_pid" -o command= 2>/dev/null || true)"
  fi
  if [[ "$prior_command" == *"run-junkware-schedule-detector.sh"* ]]; then
    echo "JunkWare schedule detector skipped: prior run is still active."
    exit 0
  fi
  echo "JunkWare schedule detector recovered a stale lock."
  rm -f "$LOCK_PID_FILE"
  rmdir "$LOCK_DIR" 2>/dev/null || {
    echo "JunkWare schedule detector could not recover its stale lock." >&2
    exit 1
  }
  mkdir "$LOCK_DIR"
fi
printf '%s\n' "$$" > "$LOCK_PID_FILE"
trap 'rm -f "$LOCK_PID_FILE"; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

cd "$OPSBOT_DIR"
python3 scripts/collect_junkware_daily.py --date "$DATE" --schedule-only
cd "$OPSCENTER_DIR"
OPSCENTER_DATA_DIR="$OPSBOT_DIR/data" ./node_modules/.bin/tsx scripts/publish-junkware-schedule-changes.ts --data-dir "$OPSBOT_DIR/data" --date "$DATE"
