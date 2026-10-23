#!/bin/zsh
# Shared bounded singleton lifecycle. Sourced by the installed controller.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PRODUCTION_LABEL="com.openclaw.opscenter"
PREVIEW_LABEL="com.openclaw.opscenter.macmini-preview"
WHATSAPP_PHOTO_LABEL="com.openclaw.opscenter.whatsapp-photos"
LINXUP_COLLECTOR_LABEL="com.openclaw.opsbot.linxup-collector"
JUNKWARE_COLLECTOR_LABEL="com.openclaw.opsbot.junkware-collector"
JUNKWARE_SCHEDULE_DETECTOR_LABEL="com.openclaw.opsbot.junkware-schedule-detector"
JUNKWARE_HISTORY_RECONCILIATION_LABEL="com.openclaw.opsbot.junkware-history-reconciliation"
SEARCHKINGS_COLLECTOR_LABEL="com.openclaw.opsbot.searchkings-collector"
PODIUM_REVIEWS_COLLECTOR_LABEL="com.openclaw.opsbot.podium-reviews-collector"
BROWSER_KEEPALIVE_LABEL="com.openclaw.opsbot.browser-keepalive"
JUNKWARE_MARKET_WATCHER_LABEL_PREFIX="com.openclaw.opsbot.junkware-schedule-watcher-"
RESTART_WHATSAPP_PHOTO_WORKER="${OPSCENTER_RESTART_WHATSAPP_PHOTO_WORKER:-true}"
RELEASE_SERVICE_RESTART_TIMEOUT_SECONDS="${OPSCENTER_SERVICE_RESTART_TIMEOUT_SECONDS:-20}"
RESTARTED_SERVICE_LABELS=()

service_loaded() {
  launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1
}

service_run_count() {
  launchctl print "gui/$(id -u)/$1" 2>/dev/null \
    | awk '/^[[:space:]]*runs = [0-9]+;$/ { gsub(/[^0-9]/, "", $0); print; exit }'
}

restart_loaded_service_with_timeout() {
  local label="$1"
  local restart_pid restart_status=0 remaining runs_before runs_after

  runs_before="$(service_run_count "$label")"
  launchctl kickstart -k "gui/$(id -u)/$label" &
  restart_pid=$!
  remaining="$RELEASE_SERVICE_RESTART_TIMEOUT_SECONDS"
  while kill -0 "$restart_pid" 2>/dev/null; do
    if (( remaining == 0 )); then
      runs_after="$(service_run_count "$label")"
      kill "$restart_pid" 2>/dev/null || true
      wait "$restart_pid" 2>/dev/null || true
      if [[ "$runs_before" =~ ^[0-9]+$ && "$runs_after" =~ ^[0-9]+$ && "$runs_after" -gt "$runs_before" ]]; then
        echo "Restart began but launchctl did not return within ${RELEASE_SERVICE_RESTART_TIMEOUT_SECONDS}s: $label" >&2
        return 0
      fi
      echo "Timed out restarting loaded service after ${RELEASE_SERVICE_RESTART_TIMEOUT_SECONDS}s: $label" >&2
      return 1
    fi
    sleep 1
    remaining=$((remaining - 1))
  done
  wait "$restart_pid" || restart_status=$?
  return "$restart_status"
}

restart_loaded_service() {
  local label="$1"
  service_loaded "$label" || return 0

  echo "Restarting loaded service: $label"
  restart_loaded_service_with_timeout "$label" || {
    echo "Failed to restart loaded service: $label" >&2
    return 1
  }
  service_loaded "$label" || {
    echo "Service disappeared after restart: $label" >&2
    return 1
  }
  RESTARTED_SERVICE_LABELS+=("$label")
}

loaded_market_watcher_labels() {
  launchctl list \
    | awk -v prefix="$JUNKWARE_MARKET_WATCHER_LABEL_PREFIX" '$3 ~ ("^" prefix) { print $3 }'
}

restart_release_bound_collectors() {
  local release="$1"
  local watcher_label
  local -a market_watchers

  restart_loaded_service "$BROWSER_KEEPALIVE_LABEL" || return 1
  restart_loaded_service "$JUNKWARE_COLLECTOR_LABEL" || return 1
  restart_loaded_service "$JUNKWARE_HISTORY_RECONCILIATION_LABEL" || return 1
  restart_loaded_service "$SEARCHKINGS_COLLECTOR_LABEL" || return 1
  restart_loaded_service "$PODIUM_REVIEWS_COLLECTOR_LABEL" || return 1

  market_watchers=("${(@f)$(loaded_market_watcher_labels)}") || return 1
  for watcher_label in "${market_watchers[@]}"; do
    [[ -n "$watcher_label" ]] || continue
    restart_loaded_service "$watcher_label" || return 1
  done

  # Production owns the low-latency detector. Reinstalling also repairs a
  # missing or unloaded LaunchAgent and ends by kickstarting it.
  "$release/deploy/macmini/install-junkware-schedule-detector.sh" || return 1
  if service_loaded "$JUNKWARE_SCHEDULE_DETECTOR_LABEL"; then
    RESTARTED_SERVICE_LABELS+=("$JUNKWARE_SCHEDULE_DETECTOR_LABEL")
  fi

  # LinxUp refreshes its installed plist so policy changes travel with the
  # immutable release; its installer ends by kickstarting the loaded service.
  if service_loaded "$LINXUP_COLLECTOR_LABEL"; then
    "$release/deploy/macmini/install-linxup-collector.sh" || return 1
    RESTARTED_SERVICE_LABELS+=("$LINXUP_COLLECTOR_LABEL")
  fi
}

restart_release_bound_services() {
  local release="$1"

  if service_loaded "$WHATSAPP_PHOTO_LABEL" && whatsapp_photo_worker_restart_enabled; then
    restart_loaded_service "$WHATSAPP_PHOTO_LABEL" || return 1
  fi
  restart_release_bound_collectors "$release"
}

whatsapp_photo_worker_restart_enabled() {
  [[ "$RESTART_WHATSAPP_PHOTO_WORKER" == "1"
    || "$RESTART_WHATSAPP_PHOTO_WORKER" == "true"
    || "$RESTART_WHATSAPP_PHOTO_WORKER" == "yes"
    || "$RESTART_WHATSAPP_PHOTO_WORKER" == "on" ]]
}

if [[ "$ZSH_EVAL_CONTEXT" == toplevel ]]; then
  IFS= read -r start_token || exit 75
  [[ "$start_token" == start-owned-services ]] || exit 75
  [[ $# == 2 && "$2" == <-> && "$2" -gt 1 ]] || exit 64
  [[ "$(id -un)" == missioncontrol ]] || exit 77
  [[ "$1" =~ ^/Users/missioncontrol/opscenter-v2/releases/[a-f0-9]{40}$ ]] || exit 65
  owner="$(cat /Users/missioncontrol/opscenter-v2/.deploy-lock/owner)"
  [[ "$owner" == *"pid=$2"$'\n'* || "$owner" == "pid=$2" ]] || exit 75
  kill -0 "$2" || exit 75
  restart_release_bound_services "$1"
fi
