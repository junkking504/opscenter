#!/bin/bash
set -Eeuo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
MARKET_ID="${1:?market ID is required}"
DATE="${2:-$(TZ=America/Chicago date +%F)}"
MARKET_DIR="$OPSBOT_DIR/data/history/junkware/schedule-watchers/$MARKET_ID"
SNAPSHOT_FILE="$MARKET_DIR/junkware_schedule_fast_${DATE}.json"
LOCK_DIR="$OPSBOT_DIR/tmp/junkware_schedule_market_${MARKET_ID}.lock"
HEALTH_DIR="$OPSBOT_DIR/data/slack/junkware_schedule_watchers"
HEALTH_FILE="$HEALTH_DIR/$MARKET_ID.json"
WATCH_INTERVAL_SECONDS="${JUNKWARE_SCHEDULE_WATCHER_INTERVAL_SECONDS:-10}"

case "$MARKET_ID" in
  352|477|399|484) ;;
  *) echo "Unknown JunkWare schedule market: $MARKET_ID" >&2; exit 64 ;;
esac

for ENV_FILE in "$OPSBOT_DIR/.env" "$OPSBOT_DIR/.env.local" "$USER_HOME/.openclaw/.env" "$OPSCENTER_DIR/.env.slack.local"; do
  if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
  fi
done

mkdir -p "$MARKET_DIR" "$OPSBOT_DIR/tmp" "$OPSBOT_DIR/logs" "$HEALTH_DIR"
write_health() {
  local status="$1"
  local exit_code="$2"
  local started_at="$3"
  local completed_at
  completed_at="$(TZ=America/Chicago date -Iseconds)"
  local temp_file="$HEALTH_FILE.tmp"
  printf '{"market_id":"%s","status":"%s","started_at":"%s","completed_at":"%s","exit_code":%s}\n' \
    "$MARKET_ID" "$status" "$started_at" "$completed_at" "$exit_code" > "$temp_file"
  mv "$temp_file" "$HEALTH_FILE"
}

run_once() {
  local started_at
  local exit_code=0
  started_at="$(TZ=America/Chicago date -Iseconds)"

  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    local prior_pid=""
    if [ -f "$LOCK_DIR/pid" ]; then
      prior_pid="$(tr -dc '0-9' < "$LOCK_DIR/pid")"
    fi
    if [ -n "$prior_pid" ] && kill -0 "$prior_pid" 2>/dev/null; then
      echo "JunkWare schedule watcher [$MARKET_ID] skipped: prior run is still active."
      return 0
    fi
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR"
    mkdir "$LOCK_DIR"
  fi
  printf '%s\n' "$$" > "$LOCK_DIR/pid"

  set +e
  (
    cd "$OPSCENTER_DIR" || exit 1
    python3 scripts/collect-junkware-schedule-market.py \
      --date "$DATE" \
      --market-id "$MARKET_ID" \
      --output-dir "$MARKET_DIR" || exit $?

    OPSCENTER_DATA_DIR="$OPSBOT_DIR/data" ./node_modules/.bin/tsx scripts/publish-junkware-schedule-changes.ts \
      --data-dir "$OPSBOT_DIR/data" \
      --date "$DATE" \
      --snapshot-file "$SNAPSHOT_FILE" \
      --scope "market-$MARKET_ID"
  )
  exit_code=$?
  set -e

  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR"
  if [ "$exit_code" -eq 0 ]; then
    write_health "ok" 0 "$started_at"
  else
    write_health "failed" "$exit_code" "$started_at"
  fi
  return "$exit_code"
}

if [ "${JUNKWARE_SCHEDULE_WATCHER_ONCE:-false}" = "true" ]; then
  run_once
  exit $?
fi

while true; do
  run_once || true
  sleep "$WATCH_INTERVAL_SECONDS"
done
