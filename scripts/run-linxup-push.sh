#!/bin/bash
set -Eeuo pipefail

PAYLOAD_FILE="${1:---drain}"
USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOCK_DIR="$OPSBOT_DIR/tmp/linxup_live_refresh.lock"

mkdir -p "$OPSBOT_DIR/tmp"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Receiver has already persisted the event. The minute collector will drain
  # it under this same lock; contention is not a failed webhook delivery.
  [[ "$PAYLOAD_FILE" == "--drain" ]] && exit 0
  exit 75
fi
cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT

cd "$OPSCENTER_DIR"
export OPSCENTER_DATA_DIR="${OPSCENTER_DATA_DIR:-$OPSBOT_DIR/data}"
if [[ "$PAYLOAD_FILE" == "--drain" ]]; then
  target_dates=$(node --import tsx scripts/drain-linxup-push.ts --dates)
else
  node --import tsx scripts/ingest-linxup-push.ts --payload-file "$PAYLOAD_FILE"
  target_dates=$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(Number(p.date ?? p.positionDate))))' "$PAYLOAD_FILE")
fi

cd "$OPSBOT_DIR"
export PYTHONPYCACHEPREFIX="/private/tmp/opscenter-linxup-pycache"
for target_date in $target_dates; do
[[ "$target_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || exit 64
cd "$OPSBOT_DIR"
python3 scripts/seed_local_appointment_geocodes.py --date "$target_date"
python3 scripts/match_linxup_appointment_visits.py --date "$target_date"
python3 scripts/validate_linxup_appointment_visits.py --date "$target_date"

if [ -f "$OPSCENTER_DIR/.env.slack.local" ]; then
  set -a
  . "$OPSCENTER_DIR/.env.slack.local"
  set +a
fi
if [[ "${SLACK_OPSCENTER_ALERTS_ENABLED:-false}" =~ ^(1|true|yes|on)$ ]]; then
  cd "$OPSCENTER_DIR"
  node --import tsx scripts/publish-slack-alerts.ts --date "$target_date" --only truck_arrival
fi
done
