#!/bin/bash
set -u

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
OPSCENTER_VPS="${OPSCENTER_VPS:-opscenter@104.248.63.228}"
OPSCENTER_SSH_KEY="${OPSCENTER_SSH_KEY:-$USER_HOME/.ssh/id_ed25519_opscenter}"
# Target start-to-start cadence; the loop subtracts each completed cycle's runtime.
REFRESH_INTERVAL_SECONDS=180
FAILED_REFRESH_RETRY_SECONDS=15
MAX_FAILED_REFRESH_RETRY_SECONDS=300
NETWORK_POLL_SECONDS=5
SLACK_ALERT_MIN_INTERVAL_SECONDS=60
TOMORROW_REFRESH_INTERVAL_SECONDS=3600
JUNKWARE_SMS_SIGNAL_URL="${JUNKWARE_SMS_SIGNAL_URL:-https://hooks.junk-king.app/api/integrations/junkware/sms/status}"
LAST_SMS_SEQUENCE=0
SMS_PENDING_DATES=()
CONSECUTIVE_FAILED_CYCLES=0
LAST_SLACK_ALERT_RUN=0
export PYTHONPYCACHEPREFIX="/private/tmp/opscenter-live-pycache"

if [ -f "$OPSCENTER_DIR/scripts/load-opscenter-secrets.sh" ]; then
  . "$OPSCENTER_DIR/scripts/load-opscenter-secrets.sh"
fi

network_available() {
  local reachability
  reachability=$(/usr/sbin/scutil -r junkware.junk-king.com 2>/dev/null) || return 1
  [[ "$reachability" == Reachable* ]]
}

failed_refresh_retry_seconds() {
  local failed_cycles="${1:-1}"
  local retry_seconds="$FAILED_REFRESH_RETRY_SECONDS"
  local attempt=1

  while [ "$attempt" -lt "$failed_cycles" ] && [ "$retry_seconds" -lt "$MAX_FAILED_REFRESH_RETRY_SECONDS" ]
  do
    retry_seconds=$((retry_seconds * 2))
    attempt=$((attempt + 1))
  done

  if [ "$retry_seconds" -gt "$MAX_FAILED_REFRESH_RETRY_SECONDS" ]; then
    retry_seconds="$MAX_FAILED_REFRESH_RETRY_SECONDS"
  fi
  printf '%s\n' "$retry_seconds"
}

auto_virtualize_external_bookings() {
  local schedule_date="$1"
  (
    cd "$OPSCENTER_DIR" || return 1
    ./node_modules/.bin/tsx \
      scripts/auto-virtualize-external-bookings.ts \
      --date "$schedule_date" \
      --data-dir "$OPSBOT_DIR/data"
  )
}

queue_sms_refresh_date() {
  local schedule_date="$1"
  [[ "$schedule_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || return 0
  local queued_date
  for queued_date in "${SMS_PENDING_DATES[@]:-}"
  do
    [ "$queued_date" = "$schedule_date" ] && return 0
  done
  SMS_PENDING_DATES+=("$schedule_date")
}

poll_sms_signal() {
  [ -n "${JUNKWARE_SMS_REFRESH_TOKEN:-}" ] || return 1
  local response parsed signal_sequence signal_dates signal_date
  response=$(/usr/bin/curl -fsS --max-time 4 \
    -H "Authorization: Bearer ${JUNKWARE_SMS_REFRESH_TOKEN}" \
    "${JUNKWARE_SMS_SIGNAL_URL}?after=${LAST_SMS_SEQUENCE}") || return 1
  parsed=$(printf '%s' "$response" | /usr/bin/python3 -c '
import json, re, sys
payload = json.load(sys.stdin)
sequence = int(payload.get("sequence") or 0)
dates = sorted({
    str(date)
    for event in payload.get("events") or []
    for date in event.get("appointmentDates") or []
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date))
})
print(f"{sequence}\t{chr(44).join(dates)}")
' 2>/dev/null) || return 1
  read -r signal_sequence signal_dates <<< "$parsed"
  [[ "$signal_sequence" =~ ^[0-9]+$ ]] || return 1
  [ "$signal_sequence" -gt "$LAST_SMS_SEQUENCE" ] || return 1
  LAST_SMS_SEQUENCE="$signal_sequence"

  if [ -n "$signal_dates" ]; then
    local old_ifs="$IFS"
    IFS=','
    for signal_date in $signal_dates
    do
      queue_sms_refresh_date "$signal_date"
    done
    IFS="$old_ifs"
  else
    queue_sms_refresh_date "$TODAY"
    queue_sms_refresh_date "$TOMORROW"
  fi
  return 0
}

refresh_junkware_signal_date() {
  local schedule_date="$1"
  local junkware_dir="$OPSBOT_DIR/data/history/junkware"
  echo "SMS-triggered JunkWare schedule refresh: $schedule_date"
  (
    cd "$OPSBOT_DIR" || exit 1
    python3 scripts/collect_junkware_daily.py --date "$schedule_date" || exit 1
    for required_file in \
      "$junkware_dir/junkware_${schedule_date}_raw.json" \
      "$junkware_dir/junkware_live_${schedule_date}_summary.csv" \
      "$junkware_dir/junkware_completed_${schedule_date}_summary.csv" \
      "$junkware_dir/junkware_employees_${schedule_date}_summary.csv"
    do
      [ -s "$required_file" ] || { echo "SMS refresh missing required file: $required_file"; exit 1; }
    done
    python3 scripts/process_daily_metrics.py --date "$schedule_date"
  )
}

for ENV_FILE in \
  "$OPSBOT_DIR/.env" \
  "$OPSBOT_DIR/.env.local" \
  "$USER_HOME/.openclaw/.env" \
  "$OPSCENTER_DIR/.env.sms.local" \
  "$OPSCENTER_DIR/.env.slack.local"
do
  if [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
  fi
done

mkdir -p "$OPSBOT_DIR/logs"

while true
do
  CYCLE_STARTED=$(date +%s)
  TODAY=$(TZ=America/Chicago date +%F)
  YESTERDAY=$(TZ=America/Chicago date -v-1d +%F)
  TOMORROW=$(TZ=America/Chicago date -v+1d +%F)
  CYCLE_SMS_DATES=("${SMS_PENDING_DATES[@]:-}")
  SMS_PENDING_DATES=()

  echo ==================================================
  echo "LIVE REFRESH: $TODAY $(TZ=America/Chicago date)"
  PUBLISH_SUCCEEDED=false
  CYCLE_COMPLETE=true

  if ! network_available; then
    echo "Network is offline; current-data refresh will retry as soon as connectivity returns."
    for SMS_DATE in "${CYCLE_SMS_DATES[@]:-}"
    do
      queue_sms_refresh_date "$SMS_DATE"
    done
  elif ! "$OPSBOT_DIR/scripts/run_opscenter_refresh.sh" "$TODAY"; then
    echo "WARNING: full OpsCenter refresh failed."
    CYCLE_COMPLETE=false
    for SMS_DATE in "${CYCLE_SMS_DATES[@]:-}"
    do
      queue_sms_refresh_date "$SMS_DATE"
    done
  else
    auto_virtualize_external_bookings "$TODAY" \
      || echo "WARNING: new external-booking Virtual Truck assignment is pending retry."
    python3 "$OPSCENTER_DIR/scripts/reconcile-junkware-monthly.py" \
      || echo "WARNING: JunkWare monthly snapshot refresh failed."

    for SMS_DATE in "${CYCLE_SMS_DATES[@]:-}"
    do
      [ -n "$SMS_DATE" ] || continue
      [ "$SMS_DATE" = "$TODAY" ] && continue
      if refresh_junkware_signal_date "$SMS_DATE"; then
        auto_virtualize_external_bookings "$SMS_DATE" \
          || echo "WARNING: SMS-triggered external-booking assignment is pending retry for $SMS_DATE."
      else
        echo "WARNING: SMS-triggered JunkWare refresh failed for $SMS_DATE."
        queue_sms_refresh_date "$SMS_DATE"
        CYCLE_COMPLETE=false
      fi
    done

    for PAYMENT_DATE in "$TODAY" "$YESTERDAY"
    do
      if npm --prefix "$OPSCENTER_DIR" run collect:qbo -- --date "$PAYMENT_DATE"; then
        python3 "$OPSCENTER_DIR/scripts/collect-payment-reconciliation.py" --date "$PAYMENT_DATE" \
          || echo "WARNING: payment reconciliation failed for $PAYMENT_DATE."
      else
        echo "WARNING: QBO Accounting API refresh failed for $PAYMENT_DATE; retaining the last verified reconciliation."
      fi
    done

    npm --prefix "$OPSCENTER_DIR" run sync:crew-portal \
      || echo "WARNING: Crew Portal data sync failed."
    (
      cd "$OPSCENTER_DIR" || exit 1
      ./node_modules/.bin/tsx scripts/collect-searchkings.ts --data-dir "$OPSBOT_DIR/data"
    ) || echo "WARNING: SearchKings refresh failed; retaining the last verified marketing snapshot."
    if ! env \
      OPSCENTER_VPS="$OPSCENTER_VPS" \
      OPSCENTER_SSH_KEY="$OPSCENTER_SSH_KEY" \
      "$OPSCENTER_DIR/deploy/vps/sync-data.sh" incremental; then
      echo "WARNING: VPS data sync failed; the VPS will retain its last verified snapshot."
    elif [ "$CYCLE_COMPLETE" = true ]; then
      PUBLISH_SUCCEEDED=true
    fi
  fi

  SLACK_ALERT_RUN_STARTED=$(date +%s)
  if [[ "${SLACK_OPSCENTER_ALERTS_ENABLED:-false}" =~ ^(1|true|yes|on)$ ]] \
    && { [ "$PUBLISH_SUCCEEDED" = true ] || [ $((SLACK_ALERT_RUN_STARTED - LAST_SLACK_ALERT_RUN)) -ge "$SLACK_ALERT_MIN_INTERVAL_SECONDS" ]; }; then
    if [ -z "${SLACK_BOT_TOKEN:-}" ]; then
      SLACK_BOT_TOKEN=$(/usr/bin/security find-generic-password \
        -a opscenter \
        -s com.opscenter.slack-bot-token \
        -w 2>/dev/null || true)
      export SLACK_BOT_TOKEN
    fi
    (
      cd "$OPSCENTER_DIR" || exit 1
      node --import tsx scripts/publish-slack-alerts.ts --date "$TODAY"
    ) || echo "WARNING: OpsCenter Slack alert publish failed."
    LAST_SLACK_ALERT_RUN=$(date +%s)
  fi

  TOMORROW_SCHEDULE="$OPSBOT_DIR/data/history/junkware/junkware_live_${TOMORROW}_summary.csv"
  TOMORROW_SCHEDULE_AGE=$TOMORROW_REFRESH_INTERVAL_SECONDS
  if [ -f "$TOMORROW_SCHEDULE" ]; then
    TOMORROW_SCHEDULE_MTIME=$(stat -f %m "$TOMORROW_SCHEDULE")
    TOMORROW_SCHEDULE_AGE=$((CYCLE_STARTED - TOMORROW_SCHEDULE_MTIME))
  fi

  if network_available && { [ ! -s "$TOMORROW_SCHEDULE" ] || [ "$TOMORROW_SCHEDULE_AGE" -ge "$TOMORROW_REFRESH_INTERVAL_SECONDS" ]; }; then
    echo "Prefetching tomorrow's JunkWare schedule: $TOMORROW"
    if ! (cd "$OPSBOT_DIR" && python3 scripts/collect_junkware_daily.py --date "$TOMORROW"); then
      echo "WARNING: tomorrow's schedule refresh failed; retaining the last verified preview."
    else
      auto_virtualize_external_bookings "$TOMORROW" \
        || echo "WARNING: tomorrow's external-booking Virtual Truck assignment is pending retry."
    fi
  fi

  CYCLE_FINISHED=$(date +%s)
  CYCLE_ELAPSED=$((CYCLE_FINISHED - CYCLE_STARTED))
  if [ "$PUBLISH_SUCCEEDED" = true ]; then
    CONSECUTIVE_FAILED_CYCLES=0
    SLEEP_SECONDS=$((REFRESH_INTERVAL_SECONDS - CYCLE_ELAPSED))
  else
    CONSECUTIVE_FAILED_CYCLES=$((CONSECUTIVE_FAILED_CYCLES + 1))
    SLEEP_SECONDS=$(failed_refresh_retry_seconds "$CONSECUTIVE_FAILED_CYCLES")
  fi
  if [ "$SLEEP_SECONDS" -lt 1 ]; then
    SLEEP_SECONDS=1
  fi
  echo "Next live refresh starts in at most $SLEEP_SECONDS seconds."

  WAIT_DEADLINE=$(($(date +%s) + SLEEP_SECONDS))
  NETWORK_WAS_AVAILABLE=false
  if network_available; then
    NETWORK_WAS_AVAILABLE=true
  fi

  while [ "$(date +%s)" -lt "$WAIT_DEADLINE" ]
  do
    REMAINING_SECONDS=$((WAIT_DEADLINE - $(date +%s)))
    POLL_SECONDS=$NETWORK_POLL_SECONDS
    if [ "$REMAINING_SECONDS" -lt "$POLL_SECONDS" ]; then
      POLL_SECONDS=$REMAINING_SECONDS
    fi
    [ "$POLL_SECONDS" -gt 0 ] || break
    sleep "$POLL_SECONDS"

    if network_available; then
      if [ "$NETWORK_WAS_AVAILABLE" = false ]; then
        echo "Network connectivity restored; starting an immediate current-data refresh."
        break
      fi
      NETWORK_WAS_AVAILABLE=true
      if poll_sms_signal; then
        echo "New JunkWare text notification received; starting an immediate schedule refresh."
        break
      fi
    else
      NETWORK_WAS_AVAILABLE=false
    fi
  done
done
