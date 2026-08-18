#!/bin/bash
set -Eeuo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
DATE="${1:-$(TZ=America/Chicago date +%F)}"
LOCK_DIR="$OPSBOT_DIR/tmp/junkware_schedule_detector.lock"
HEALTH_DIR="$OPSBOT_DIR/data/slack/junkware_schedule_watchers"
HEALTH_FILE="$HEALTH_DIR/detector.json"
WATCH_INTERVAL_SECONDS="${JUNKWARE_SCHEDULE_DETECTOR_INTERVAL_SECONDS:-10}"

for ENV_FILE in "$OPSBOT_DIR/.env" "$OPSBOT_DIR/.env.local" "$USER_HOME/.openclaw/.env" "$OPSCENTER_DIR/.env.slack.local"; do
  if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
  fi
done

mkdir -p "$OPSBOT_DIR/tmp" "$OPSBOT_DIR/logs" "$HEALTH_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  prior_pid="$(tr -dc '0-9' < "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$prior_pid" ] && kill -0 "$prior_pid" 2>/dev/null; then
    echo "JunkWare schedule detector refused duplicate start: pid $prior_pid is active."
    exit 0
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
  mkdir "$LOCK_DIR"
fi
printf '%s\n' "$$" > "$LOCK_DIR/pid"
trap 'rm -f "$LOCK_DIR/pid"; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

write_health() {
  local status="$1"
  local exit_code="$2"
  local started_at="$3"
  local completed_at
  completed_at="$(TZ=America/Chicago date -Iseconds)"
  local temp_file="$HEALTH_FILE.tmp"
  printf '{"status":"%s","started_at":"%s","completed_at":"%s","exit_code":%s}\n' \
    "$status" "$started_at" "$completed_at" "$exit_code" > "$temp_file"
  mv "$temp_file" "$HEALTH_FILE"
}

run_once() {
  local started_at
  local exit_code=0
  started_at="$(TZ=America/Chicago date -Iseconds)"

  set +e
  (
    cd "$OPSBOT_DIR" || exit 1
    python3 scripts/collect_junkware_daily.py --date "$DATE" --schedule-only || exit $?
    cd "$OPSCENTER_DIR" || exit 1
    OPSCENTER_DATA_DIR="$OPSBOT_DIR/data" ./node_modules/.bin/tsx scripts/publish-junkware-schedule-changes.ts \
      --data-dir "$OPSBOT_DIR/data" \
      --date "$DATE" \
      --scope "all-markets"
  )
  exit_code=$?
  set -e

  if [ "$exit_code" -eq 0 ]; then
    write_health "ok" 0 "$started_at"
  else
    write_health "failed" "$exit_code" "$started_at"
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
