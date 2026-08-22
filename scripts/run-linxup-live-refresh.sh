#!/bin/bash
set -Eeuo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
TARGET_DATE="${1:-$(TZ=America/Chicago date +%F)}"
LOCK_DIR="$OPSBOT_DIR/tmp/linxup_live_refresh.lock"
MAP_FILE="$OPSBOT_DIR/data/config/linxup_vehicle_map.json"
MAP_REFRESH_SECONDS="${LINXUP_MAP_REFRESH_SECONDS:-900}"
MAX_ATTEMPTS="${LINXUP_MAX_ATTEMPTS:-2}"
PUBLISH_SLACK_ALERTS="${LINXUP_PUBLISH_SLACK_ALERTS:-true}"

[[ "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
  echo "Invalid LinxUp refresh date: $TARGET_DATE" >&2
  exit 64
}

mkdir -p "$OPSBOT_DIR/tmp" "$OPSBOT_DIR/logs"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "LinxUp refresh skipped because another LinxUp refresh is active."
  exit 0
fi
cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if ! /usr/sbin/scutil -r www.awaregps.com 2>/dev/null | /usr/bin/grep -q '^Reachable'; then
  echo "LinxUp refresh deferred until network connectivity returns."
  exit 0
fi

[[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || {
  echo "Invalid LinxUp attempt count: $MAX_ATTEMPTS" >&2
  exit 64
}

refresh_once() {
  cd "$OPSBOT_DIR" || return $?
  export PYTHONPYCACHEPREFIX="/private/tmp/opscenter-linxup-pycache"

  local now_epoch map_mtime=0
  now_epoch=$(date +%s)
  if [ -f "$MAP_FILE" ]; then
    map_mtime=$(stat -f %m "$MAP_FILE")
  fi
  if [ $((now_epoch - map_mtime)) -ge "$MAP_REFRESH_SECONDS" ]; then
    python3 scripts/refresh_verified_linxup_vehicle_map.py || return $?
  fi

  python3 scripts/collect_linxup_location_history.py --date "$TARGET_DATE" || return $?
  python3 scripts/seed_local_appointment_geocodes.py --date "$TARGET_DATE" || return $?
  python3 scripts/match_linxup_appointment_visits.py --date "$TARGET_DATE" || return $?
  python3 scripts/validate_linxup_appointment_visits.py --date "$TARGET_DATE" || return $?
}

attempt=1
refresh_status=1
while (( attempt <= MAX_ATTEMPTS )); do
  if refresh_once; then
    refresh_status=0
    break
  else
    refresh_status=$?
  fi

  if (( attempt < MAX_ATTEMPTS )); then
    echo "LinxUp refresh attempt $attempt/$MAX_ATTEMPTS failed (exit $refresh_status); retrying in 10 seconds." >&2
    sleep 10
  fi
  attempt=$((attempt + 1))
done

if (( refresh_status != 0 )); then
  echo "LinxUp refresh failed after $MAX_ATTEMPTS attempt(s) (exit $refresh_status)." >&2
  exit "$refresh_status"
fi

if [ -f "$OPSCENTER_DIR/.env.slack.local" ]; then
  set -a
  . "$OPSCENTER_DIR/.env.slack.local"
  set +a
fi
if [[ "$PUBLISH_SLACK_ALERTS" =~ ^(1|true|yes|on)$ && "${SLACK_OPSCENTER_ALERTS_ENABLED:-false}" =~ ^(1|true|yes|on)$ ]]; then
  (
    cd "$OPSCENTER_DIR"
    node --import tsx scripts/publish-slack-alerts.ts \
      --date "$TARGET_DATE" \
      --only truck_arrival
  )
fi

echo "LinxUp live refresh completed at $(TZ=America/Chicago date '+%Y-%m-%d %H:%M:%S %Z')."
