#!/bin/bash
set -Eeuo pipefail

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
TARGET_DATE="${1:-$(TZ=America/Chicago date +%F)}"
LOCK_DIR="$OPSBOT_DIR/tmp/linxup_live_refresh.lock"
LOCK_HELPER="$OPSCENTER_DIR/scripts/linxup-lock.sh"
RETRY_HELPER="$OPSCENTER_DIR/scripts/linxup-retry.sh"
MAP_FILE="$OPSBOT_DIR/data/config/linxup_vehicle_map.json"
MAP_REFRESH_SECONDS="${LINXUP_MAP_REFRESH_SECONDS:-900}"
MAX_ATTEMPTS="${LINXUP_MAX_ATTEMPTS:-2}"
RETRY_DELAY_SECONDS="${LINXUP_RETRY_DELAY_SECONDS:-10}"
PUBLISH_SLACK_ALERTS="${LINXUP_PUBLISH_SLACK_ALERTS:-true}"
SKIP_REFRESH="${LINXUP_SKIP_REFRESH:-false}"

[[ "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
  echo "Invalid LinxUp refresh date: $TARGET_DATE" >&2
  exit 64
}

if [[ "$SKIP_REFRESH" =~ ^(1|true|yes|on)$ ]]; then
  echo "LinxUp refresh skipped for a non-operational historical reconciliation."
  exit 0
fi

mkdir -p "$OPSBOT_DIR/tmp" "$OPSBOT_DIR/logs"

[[ -r "$LOCK_HELPER" ]] || {
  echo "LinxUp lock helper is unavailable: $LOCK_HELPER" >&2
  exit 70
}
[[ -r "$RETRY_HELPER" ]] || {
  echo "LinxUp retry helper is unavailable: $RETRY_HELPER" >&2
  exit 70
}
LINXUP_LOCK_DIR="$LOCK_DIR"
LINXUP_LOCK_OWNER_KIND="poll"
. "$LOCK_HELPER"
. "$RETRY_HELPER"
if linxup_lock_acquire; then
  trap linxup_lock_release EXIT
else
  lock_status=$?
  if (( lock_status == LINXUP_LOCK_ACTIVE )); then
    echo "LinxUp refresh skipped because another LinxUp processor is genuinely active."
    exit 0
  fi
  exit "$lock_status"
fi

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

if linxup_retry "$MAX_ATTEMPTS" "$RETRY_DELAY_SECONDS" refresh_once; then
  refresh_status=0
else
  refresh_status=$?
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
