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
STARTED_AT="$(TZ=America/Chicago date -Iseconds)"

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
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "JunkWare schedule watcher [$MARKET_ID] skipped: prior run is still active."
  exit 0
fi
write_health() {
  local status="$1"
  local exit_code="$2"
  local completed_at
  completed_at="$(TZ=America/Chicago date -Iseconds)"
  local temp_file="$HEALTH_FILE.tmp"
  printf '{"market_id":"%s","status":"%s","started_at":"%s","completed_at":"%s","exit_code":%s}\n' \
    "$MARKET_ID" "$status" "$STARTED_AT" "$completed_at" "$exit_code" > "$temp_file"
  mv "$temp_file" "$HEALTH_FILE"
}
trap 'exit_code=$?; if [ "$exit_code" -eq 0 ]; then write_health "ok" 0; else write_health "failed" "$exit_code"; fi; rmdir "$LOCK_DIR" 2>/dev/null || true; exit "$exit_code"' EXIT

cd "$OPSCENTER_DIR"
python3 scripts/collect-junkware-schedule-market.py \
  --date "$DATE" \
  --market-id "$MARKET_ID" \
  --output-dir "$MARKET_DIR"

OPSCENTER_DATA_DIR="$OPSBOT_DIR/data" ./node_modules/.bin/tsx scripts/publish-junkware-schedule-changes.ts \
  --data-dir "$OPSBOT_DIR/data" \
  --date "$DATE" \
  --snapshot-file "$SNAPSHOT_FILE" \
  --scope "market-$MARKET_ID"
