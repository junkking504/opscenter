#!/bin/bash
set -Eeuo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
DATE_OVERRIDE="${1:-}"
LOCK_DIR="$OPSBOT_DIR/tmp/junkware_schedule_detector.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"
HEALTH_DIR="$OPSBOT_DIR/data/slack/junkware_schedule_watchers"
# The persistent in-session sweep measured about 17 seconds across all four
# markets. Five seconds between sweeps targets a roughly 22-second same-market
# read cadence without overlapping JunkWare sessions.
WATCH_INTERVAL_SECONDS="${JUNKWARE_SCHEDULE_DETECTOR_INTERVAL_SECONDS:-5}"

for ENV_FILE in "$OPSBOT_DIR/.env" "$OPSBOT_DIR/.env.local" "$USER_HOME/.openclaw/.env" "$OPSCENTER_DIR/.env.slack.local"; do
  if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
  fi
done

mkdir -p "$OPSBOT_DIR/tmp" "$OPSBOT_DIR/logs" "$HEALTH_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  prior_pid="$(tr -dc '0-9' < "$LOCK_PID_FILE" 2>/dev/null || true)"
  if [ -n "$prior_pid" ] && kill -0 "$prior_pid" 2>/dev/null; then
    echo "JunkWare schedule detector refused duplicate start: pid $prior_pid is active."
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

cd "$OPSCENTER_DIR"
ARGS=(
  --opscenter-dir "$OPSCENTER_DIR"
  --data-dir "$OPSBOT_DIR/data"
  --watch-interval "$WATCH_INTERVAL_SECONDS"
)
[ -n "$DATE_OVERRIDE" ] && ARGS+=(--date "$DATE_OVERRIDE")
[ "${JUNKWARE_SCHEDULE_DETECTOR_ONCE:-false}" = "true" ] && ARGS+=(--once)
python3 scripts/collect-junkware-schedule-stream.py "${ARGS[@]}"
