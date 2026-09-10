#!/bin/bash
set -Eeuo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
TARGET_DATE="${1:-$(TZ=America/Chicago date +%F)}"
LOCK_DIR="$OPSBOT_DIR/tmp/linxup_live_refresh.lock"
MAP_FILE="$OPSBOT_DIR/data/config/linxup_vehicle_map.json"
MAP_REFRESH_SECONDS="${LINXUP_MAP_REFRESH_SECONDS:-900}"

[[ "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
  echo "Invalid LinxUp refresh date: $TARGET_DATE" >&2
  exit 64
}

mkdir -p "$OPSBOT_DIR/tmp" "$OPSBOT_DIR/logs"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "LinxUp refresh skipped because another LinxUp refresh is active."
  exit 0
fi
geofence_pid=""
cleanup() {
  # Keep the refresh lock until the bounded alert read also finishes. Its
  # failure must not abort GPS processing or confirmed appointment alerts.
  if [ -n "$geofence_pid" ]; then wait "$geofence_pid" || true; fi
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# Recover accepted events after a server restart or a busy processor. This is
# local-only and runs before the network check, sharing the snapshot-write lock.
drain_push_queue() {
  (cd "$OPSCENTER_DIR" && OPSCENTER_DATA_DIR="$OPSBOT_DIR/data" node --import tsx scripts/drain-linxup-push.ts)
}
drain_push_queue

if ! /usr/sbin/scutil -r www.awaregps.com 2>/dev/null | /usr/bin/grep -q '^Reachable'; then
  echo "LinxUp refresh deferred until network connectivity returns."
  exit 0
fi

cd "$OPSBOT_DIR"
export PYTHONPYCACHEPREFIX="/private/tmp/opscenter-linxup-pycache"

# Facility entries are a separate LinxUp feed from position push/polling.
# Read them every minute without waiting for JunkWare's slower full refresh.
python3 "$OPSCENTER_DIR/scripts/refresh-linxup-geofence-alerts.py" "$TARGET_DATE" "$OPSBOT_DIR" &
geofence_pid=$!

now_epoch=$(date +%s)
map_mtime=0
if [ -f "$MAP_FILE" ]; then
  map_mtime=$(stat -f %m "$MAP_FILE")
fi
if [ $((now_epoch - map_mtime)) -ge "$MAP_REFRESH_SECONDS" ]; then
  python3 scripts/refresh_verified_linxup_vehicle_map.py
fi

python3 scripts/collect_linxup_location_history.py --date "$TARGET_DATE"
drain_push_queue
# Keep visit matching and automatic address checks aligned with the live board.
(cd "$OPSCENTER_DIR" && OPSCENTER_DATA_DIR="$OPSBOT_DIR/data" OPSBOT_DATA_DIR="$OPSBOT_DIR/data" node --import tsx scripts/refresh-schedule-map-inputs.ts "$TARGET_DATE") || echo "Schedule map inputs pending; retaining previous verified data." >&2
python3 scripts/seed_local_appointment_geocodes.py --date "$TARGET_DATE"
python3 "$OPSCENTER_DIR/scripts/match-linxup-instant-arrivals.py" --date "$TARGET_DATE"
python3 scripts/validate_linxup_appointment_visits.py --date "$TARGET_DATE"

if [ -f "$OPSCENTER_DIR/.env.slack.local" ]; then
  set -a
  . "$OPSCENTER_DIR/.env.slack.local"
  set +a
fi
if [[ "${SLACK_OPSCENTER_ALERTS_ENABLED:-false}" =~ ^(1|true|yes|on)$ ]]; then
  (
    cd "$OPSCENTER_DIR"
    node --import tsx scripts/publish-slack-alerts.ts \
      --date "$TARGET_DATE" \
      --only truck_arrival,truck_departure
  )
fi

wait "$geofence_pid" || true
geofence_pid=""
echo "LinxUp live refresh completed at $(TZ=America/Chicago date '+%Y-%m-%d %H:%M:%S %Z')."
