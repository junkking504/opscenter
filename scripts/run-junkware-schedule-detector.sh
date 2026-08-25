#!/bin/bash
set -Eeuo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
# An explicit date is useful for a one-off recovery run. The persistent worker
# resolves the Chicago business date inside each sweep so it rolls over without
# requiring a LaunchAgent restart.
DATE_OVERRIDE="${1:-}"
LOCK_DIR="$OPSBOT_DIR/tmp/junkware_schedule_detector.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"
HEALTH_DIR="$OPSBOT_DIR/data/slack/junkware_schedule_watchers"
HEALTH_FILE="$HEALTH_DIR/detector.json"
# A verified all-market sweep currently takes about 45 seconds. Five seconds
# between sweeps keeps the same market below a 60-second read cadence while
# avoiding overlapping JunkWare sessions.
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

write_health() {
  local status="$1"
  local exit_code="$2"
  local started_at="$3"
  local started_epoch="$4"
  local completed_at completed_epoch duration_seconds temp_file
  completed_at="$(TZ=America/Chicago date -Iseconds)"
  completed_epoch="$(date +%s)"
  duration_seconds=$((completed_epoch - started_epoch))
  temp_file="$HEALTH_FILE.tmp"
  printf '{"status":"%s","started_at":"%s","completed_at":"%s","duration_seconds":%s,"exit_code":%s}\n' \
    "$status" "$started_at" "$completed_at" "$duration_seconds" "$exit_code" > "$temp_file"
  mv "$temp_file" "$HEALTH_FILE"
}

run_once() {
  local run_date started_at started_epoch exit_code
  run_date="${DATE_OVERRIDE:-$(TZ=America/Chicago date +%F)}"
  started_at="$(TZ=America/Chicago date -Iseconds)"
  started_epoch="$(date +%s)"
  exit_code=0
  echo "JunkWare schedule detector sweep started: $started_at ($run_date)"

  set +e
  (
    cd "$OPSCENTER_DIR" || exit 1
    python3 scripts/collect-junkware-schedule-stream.py \
      --opscenter-dir "$OPSCENTER_DIR" \
      --data-dir "$OPSBOT_DIR/data" \
      --date "$run_date"
  )
  exit_code=$?
  set -e

  if [ "$exit_code" -eq 0 ]; then
    write_health "ok" 0 "$started_at" "$started_epoch"
  else
    write_health "failed" "$exit_code" "$started_at" "$started_epoch"
  fi
  return "$exit_code"
}

if [ "${JUNKWARE_SCHEDULE_DETECTOR_ONCE:-false}" = "true" ]; then
  run_once
  exit $?
fi

while true; do
  run_once || true
  sleep "$WATCH_INTERVAL_SECONDS"
done
