#!/bin/bash
set -Eeuo pipefail

PAYLOAD_FILE="${1:?LinxUp push payload file is required}"
USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOCK_DIR="$OPSBOT_DIR/tmp/linxup_live_refresh.lock"

mkdir -p "$OPSBOT_DIR/tmp"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "LinxUp push deferred because another LinxUp processor is active." >&2
  exit 75
fi
cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT

cd "$OPSCENTER_DIR"
node --import tsx scripts/ingest-linxup-push.ts --payload-file "$PAYLOAD_FILE"

cd "$OPSBOT_DIR"
export PYTHONPYCACHEPREFIX="/private/tmp/opscenter-linxup-pycache"
target_date=$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(Number(p.date ?? p.positionDate))); const v=t=>parts.find(x=>x.type===t)?.value; console.log(`${v("year")}-${v("month")}-${v("day")}`)' "$PAYLOAD_FILE")
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
