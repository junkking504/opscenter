#!/bin/bash
set -Eeuo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
DATE="${1:-$(TZ=America/Chicago date +%F)}"
LOCK_DIR="$OPSBOT_DIR/tmp/junkware_schedule_detector.lock"

for ENV_FILE in "$OPSBOT_DIR/.env" "$OPSBOT_DIR/.env.local" "$USER_HOME/.openclaw/.env" "$OPSCENTER_DIR/.env.slack.local"; do
  if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
  fi
done

mkdir -p "$OPSBOT_DIR/tmp" "$OPSBOT_DIR/logs"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "JunkWare schedule detector skipped: prior run is still active."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

cd "$OPSBOT_DIR"
python3 scripts/collect_junkware_daily.py --date "$DATE" --schedule-only
cd "$OPSCENTER_DIR"
OPSCENTER_DATA_DIR="$OPSBOT_DIR/data" ./node_modules/.bin/tsx scripts/publish-junkware-schedule-changes.ts --data-dir "$OPSBOT_DIR/data" --date "$DATE"
