#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="${0:A:h}"
source "$SCRIPT_DIR/release-lineage.sh"

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
DEPLOY_ROOT="$EXPECTED_HOME/opscenter-v2"
APP_LINK="$DEPLOY_ROOT/opscenter"
REPOSITORY="$DEPLOY_ROOT/repository"
RELEASES_DIR="$DEPLOY_ROOT/releases"
SHARED_LOGS="$EXPECTED_HOME/Library/Logs/OpsCenter"
SHARED_CONFIG="$EXPECTED_HOME/Library/Application Support/OpsCenter"
SLACK_ENV="$SHARED_CONFIG/slack.env"
DATA_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/data"
PRODUCTION_LABEL="com.openclaw.opscenter"
PREVIEW_LABEL="com.openclaw.opscenter.macmini-preview"
WHATSAPP_PHOTO_LABEL="com.openclaw.opscenter.whatsapp-photos"
LINXUP_COLLECTOR_LABEL="com.openclaw.opsbot.linxup-collector"
JUNKWARE_COLLECTOR_LABEL="com.openclaw.opsbot.junkware-collector"
JUNKWARE_SCHEDULE_DETECTOR_LABEL="com.openclaw.opsbot.junkware-schedule-detector"
JUNKWARE_HISTORY_RECONCILIATION_LABEL="com.openclaw.opsbot.junkware-history-reconciliation"
SEARCHKINGS_COLLECTOR_LABEL="com.openclaw.opsbot.searchkings-collector"
BROWSER_KEEPALIVE_LABEL="com.openclaw.opsbot.browser-keepalive"
JUNKWARE_MARKET_WATCHER_LABEL_PREFIX="com.openclaw.opsbot.junkware-schedule-watcher-"
REQUESTED_REF="${1:-}"
RESTART_WHATSAPP_PHOTO_WORKER="${OPSCENTER_RESTART_WHATSAPP_PHOTO_WORKER:-true}"
RELEASE_RETENTION="${OPSCENTER_RELEASE_RETENTION:-8}"
RELEASE_LSOF_TIMEOUT_SECONDS="${OPSCENTER_RELEASE_LSOF_TIMEOUT_SECONDS:-5}"
RELEASE_SERVICE_RESTART_TIMEOUT_SECONDS="${OPSCENTER_SERVICE_RESTART_TIMEOUT_SECONDS:-20}"
ALLOW_NON_FORWARD="${2:-0}"
DEPLOY_LOCK_DIR="$DEPLOY_ROOT/.deploy-lock"
DEPLOY_LOCK_HELD=false
RESTARTED_SERVICE_LABELS=()

fail() {
  echo "Mission Control deployment stopped: $*" >&2
  exit 1
}

release_deploy_lock() {
  $DEPLOY_LOCK_HELD || return 0
  rm -f "$DEPLOY_LOCK_DIR/owner"
  rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
  DEPLOY_LOCK_HELD=false
}

acquire_deploy_lock() {
  if ! mkdir "$DEPLOY_LOCK_DIR" 2>/dev/null; then
    lock_owner="$(cat "$DEPLOY_LOCK_DIR/owner" 2>/dev/null || true)"
    [[ -n "$lock_owner" ]] || lock_owner="owner unavailable"
    fail "another deployment is already running ($lock_owner); refusing to race it"
  fi
  DEPLOY_LOCK_HELD=true
  {
    echo "pid=$$"
    echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "requested_ref=$REQUESTED_REF"
  } > "$DEPLOY_LOCK_DIR/owner"
}

require_forward_deploy() {
  local active_commit="$1"
  local requested_commit="$2"
  local check_context="$3"

  if [[ "$requested_commit" == "$active_commit" ]] \
    || git -C "$REPOSITORY" merge-base --is-ancestor "$active_commit" "$requested_commit"; then
    return 0
  fi
  if [[ "$ALLOW_NON_FORWARD" != "1" ]]; then
    fail "$check_context: requested commit $requested_commit does not contain active commit $active_commit; rebase or merge the active release first (intentional rollback requires --allow-non-forward)"
  fi
  echo "WARNING: allowing an explicitly authorized non-forward deployment: $active_commit -> $requested_commit" >&2
}

trap release_deploy_lock EXIT

service_loaded() {
  launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1
}

service_run_count() {
  launchctl print "gui/$(id -u)/$1" 2>/dev/null | awk '/^[[:space:]]*runs = [0-9]+;$/ { gsub(/[^0-9]/, "", $0); print; exit }'
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
  launchctl list | awk -v prefix="$JUNKWARE_MARKET_WATCHER_LABEL_PREFIX" '$3 ~ ("^" prefix) { print $3 }'
}

restart_release_bound_collectors() {
  local release="$1"
  local watcher_label
  local -a market_watchers

  # Browser keepalive is infrastructure rather than a data stream, but every
  # authenticated JunkWare scraper depends on its browser session.
  restart_loaded_service "$BROWSER_KEEPALIVE_LABEL" || return 1
  restart_loaded_service "$JUNKWARE_COLLECTOR_LABEL" || return 1
  restart_loaded_service "$JUNKWARE_SCHEDULE_DETECTOR_LABEL" || return 1
  restart_loaded_service "$JUNKWARE_HISTORY_RECONCILIATION_LABEL" || return 1
  restart_loaded_service "$SEARCHKINGS_COLLECTOR_LABEL" || return 1

  market_watchers=("${(@f)$(loaded_market_watcher_labels)}") || return 1
  for watcher_label in "${market_watchers[@]}"; do
    restart_loaded_service "$watcher_label" || return 1
  done

  # LinxUp also refreshes its installed plist so policy changes travel with the
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

release_has_live_process_reference() {
  local candidate="$1"
  local scan_output scan_error scan_pid scan_status=0 remaining referenced_pids

  candidate="$(cd "$candidate" && pwd -P)" || {
    echo "Skipping prune: unable to resolve the candidate release path safely." >&2
    return 0
  }

  scan_output="$(mktemp "${TMPDIR:-/tmp}/opscenter-release-lsof.XXXXXX")" || {
    echo "Skipping prune for $candidate: unable to create a bounded lsof scan." >&2
    return 0
  }
  scan_error="$(mktemp "${TMPDIR:-/tmp}/opscenter-release-lsof-error.XXXXXX")" || {
    rm -f "$scan_output"
    echo "Skipping prune for $candidate: unable to create a bounded lsof scan." >&2
    return 0
  }

  # +D sees cwd, executable text, and open files below the candidate release.
  # Limit output to PIDs so deployment logs never print runtime file paths.
  # The explicit timeout below makes a large dependency tree fail safe by
  # keeping the release instead of delaying deployment indefinitely.
  /usr/sbin/lsof -n -P -F p +D "$candidate" >"$scan_output" 2>"$scan_error" &
  scan_pid=$!
  remaining="$RELEASE_LSOF_TIMEOUT_SECONDS"
  while kill -0 "$scan_pid" 2>/dev/null; do
    if (( remaining == 0 )); then
      kill "$scan_pid" 2>/dev/null || true
      wait "$scan_pid" 2>/dev/null || true
      rm -f "$scan_output" "$scan_error"
      echo "Skipping prune for $candidate: lsof process-reference scan exceeded ${RELEASE_LSOF_TIMEOUT_SECONDS}s." >&2
      return 0
    fi
    sleep 1
    remaining=$((remaining - 1))
  done
  wait "$scan_pid" || scan_status=$?

  if [[ -s "$scan_error" || ( "$scan_status" != "0" && "$scan_status" != "1" ) ]]; then
    rm -f "$scan_output" "$scan_error"
    echo "Skipping prune for $candidate: lsof process-reference scan could not complete safely." >&2
    return 0
  fi
  referenced_pids="$(sed -n 's/^p//p' "$scan_output" | paste -sd, -)"
  if [[ -n "$referenced_pids" ]]; then
    rm -f "$scan_output" "$scan_error"
    echo "Skipping prune for $candidate: it is still referenced by running process PID $referenced_pids." >&2
    return 0
  fi

  rm -f "$scan_output" "$scan_error"
  return 1
}

whatsapp_photo_worker_restart_enabled() {
  [[ "$RESTART_WHATSAPP_PHOTO_WORKER" == "1"
    || "$RESTART_WHATSAPP_PHOTO_WORKER" == "true"
    || "$RESTART_WHATSAPP_PHOTO_WORKER" == "yes"
    || "$RESTART_WHATSAPP_PHOTO_WORKER" == "on" ]]
}

activate_release() {
  local release="$1"
  local next_link="$DEPLOY_ROOT/.opscenter-next-$$"
  rm -f "$next_link"
  ln -s "$release" "$next_link"
  /bin/mv -fh "$next_link" "$APP_LINK"
}

prune_superseded_releases() {
  local protected_current="$1"
  local protected_previous="$2"
  local -a releases
  local candidate
  local retained=0

  # Directories are named by commit SHA and are only ever created by this script.
  # Keep a compact rollback window while ensuring the live and immediate prior
  # release can never be pruned by this deployment.
  releases=("${(@f)$(/bin/ls -1dt "$RELEASES_DIR"/*(N/))}")
  for candidate in "${releases[@]}"; do
    if [[ "$candidate" == "$protected_current" || "$candidate" == "$protected_previous" || "$retained" -lt "$RELEASE_RETENTION" ]]; then
      retained=$((retained + 1))
      continue
    fi
    release_has_live_process_reference "$candidate" && continue
    git -C "$REPOSITORY" worktree remove --force "$candidate"
  done
}

wait_for_login() {
  local port="$1"
  local attempt=1
  while (( attempt <= 15 )); do
    http_status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/login" || true)"
    if [[ "$http_status" == "200" ]]; then
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  return 1
}

restore_previous_release() {
  local previous_target="$1"
  local active_label="$2"
  local active_port="$3"

  activate_release "$previous_target"
  if [[ -n "$active_label" ]]; then
    launchctl kickstart -k "gui/$(id -u)/$active_label" || true
    wait_for_login "$active_port" || true
  fi
}

[[ -n "$REQUESTED_REF" ]] || fail "usage: $0 <pushed-git-ref-or-commit> [allow-non-forward: 0|1]"
[[ "$ALLOW_NON_FORWARD" == "0" || "$ALLOW_NON_FORWARD" == "1" ]] || fail "allow-non-forward must be 0 or 1"
[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ "$RELEASE_RETENTION" == <-> && "$RELEASE_RETENTION" -ge 3 ]] || fail "OPSCENTER_RELEASE_RETENTION must be an integer of at least 3"
[[ "$RELEASE_LSOF_TIMEOUT_SECONDS" == <-> && "$RELEASE_LSOF_TIMEOUT_SECONDS" -ge 1 ]] || fail "OPSCENTER_RELEASE_LSOF_TIMEOUT_SECONDS must be a positive integer"
[[ -d "$REPOSITORY/.git" ]] || fail "run deploy/macmini/bootstrap-git-deployment.sh first"
[[ -d "$DATA_DIR" ]] || fail "missing authoritative OpsBot data: $DATA_DIR"
[[ -L "$APP_LINK" ]] || fail "$APP_LINK must be a symbolic link; run the Git bootstrap first"

for command in git node npm curl launchctl lsof; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

mkdir -p "$RELEASES_DIR" "$SHARED_LOGS" "$SHARED_CONFIG"
acquire_deploy_lock
# Reclaim old immutable releases before installing a new dependency tree. This
# keeps a failed or oversized prior deployment from consuming the space needed
# for the next recovery deployment.
active_release="$(readlink "$APP_LINK")"
[[ -d "$active_release" ]] || fail "active OpsCenter target is missing: $active_release"
prune_superseded_releases "$active_release" "$active_release"
git -C "$REPOSITORY" fetch --prune origin

commit="$(git -C "$REPOSITORY" rev-parse --verify "${REQUESTED_REF}^{commit}" 2>/dev/null || true)"
[[ -n "$commit" ]] || fail "cannot resolve $REQUESTED_REF after fetching origin"
require_production_head "$commit"

active_release="$(readlink "$APP_LINK")"
[[ -n "$active_release" ]] || fail "cannot resolve the active OpsCenter release"
active_commit="$(git -C "$active_release" rev-parse --verify HEAD 2>/dev/null || true)"
[[ -n "$active_commit" ]] || fail "cannot resolve the active release commit from $active_release"
require_forward_deploy "$active_commit" "$commit" "initial ancestry check"

active_release="$(readlink "$APP_LINK")"
[[ -n "$active_release" ]] || fail "cannot resolve the active OpsCenter release"
active_commit="$(git -C "$active_release" rev-parse --verify HEAD 2>/dev/null || true)"
[[ -n "$active_commit" ]] || fail "cannot resolve the active release commit from $active_release"
require_forward_deploy "$active_commit" "$commit" "initial ancestry check"

release="$RELEASES_DIR/$commit"
if [[ -d "$release" ]]; then
  existing_commit="$(git -C "$release" rev-parse HEAD 2>/dev/null || true)"
  [[ "$existing_commit" == "$commit" ]] || fail "$release exists but does not contain commit $commit"
else
  git -C "$REPOSITORY" worktree add --detach "$release" "$commit"
fi

if [[ -e "$release/data" && ! -L "$release/data" ]]; then
  fail "$release/data exists and is not a symbolic link"
fi
if [[ -L "$release/data" && "$(readlink "$release/data")" != "$DATA_DIR" ]]; then
  fail "$release/data points to an unexpected location"
fi
[[ -L "$release/data" ]] || ln -s "$DATA_DIR" "$release/data"

if [[ -e "$release/logs" && ! -L "$release/logs" ]]; then
  fail "$release/logs exists and is not a symbolic link"
fi
if [[ -L "$release/logs" && "$(readlink "$release/logs")" != "$SHARED_LOGS" ]]; then
  fail "$release/logs points to an unexpected location"
fi
[[ -L "$release/logs" ]] || ln -s "$SHARED_LOGS" "$release/logs"

if [[ -f "$SLACK_ENV" ]]; then
  if [[ -e "$release/.env.slack.local" && ! -L "$release/.env.slack.local" ]]; then
    fail "$release/.env.slack.local exists and is not a symbolic link"
  fi
  if [[ -L "$release/.env.slack.local" && "$(readlink "$release/.env.slack.local")" != "$SLACK_ENV" ]]; then
    fail "$release/.env.slack.local points to an unexpected location"
  fi
  [[ -L "$release/.env.slack.local" ]] || ln -s "$SLACK_ENV" "$release/.env.slack.local"
fi

cd "$release"
npm ci
npx playwright install chromium

active_label=""
active_port=""
if service_loaded "$PRODUCTION_LABEL"; then
  active_label="$PRODUCTION_LABEL"
  active_port="3000"
  npm run build
elif service_loaded "$PREVIEW_LABEL"; then
  active_label="$PREVIEW_LABEL"
  active_port="3100"
  NEXT_DIST_DIR="tmp/macmini-preview-next" npm run build
else
  npm run build
fi

{
  echo "commit=$commit"
  echo "deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$release/.opscenter-release"

latest_active_release="$(readlink "$APP_LINK")"
[[ -n "$latest_active_release" ]] || fail "cannot recheck the active OpsCenter release"
latest_active_commit="$(git -C "$latest_active_release" rev-parse --verify HEAD 2>/dev/null || true)"
[[ -n "$latest_active_commit" ]] || fail "cannot resolve the active commit during the final deployment check"
require_forward_deploy "$latest_active_commit" "$commit" "active release changed during build"

previous_target="$(readlink "$APP_LINK")"
activate_release "$release"

if [[ -n "$active_label" ]]; then
  launchctl kickstart -k "gui/$(id -u)/$active_label"
  if ! wait_for_login "$active_port"; then
    echo "New release did not become healthy; restoring $previous_target" >&2
    restore_previous_release "$previous_target" "$active_label" "$active_port"
    fail "release $commit failed its login health check and was rolled back"
  fi
fi

# All release-bound collector entrypoints use the stable active-release
# symlink. Restart every loaded collector before pruning so none can retain an
# executable, module, or working-directory reference to an obsolete release.
if ! restart_release_bound_services "$release"; then
  echo "A release-bound service could not restart; restoring $previous_target" >&2
  restore_previous_release "$previous_target" "$active_label" "$active_port"
  RESTARTED_SERVICE_LABELS=()
  restart_release_bound_services "$previous_target" || \
    echo "WARNING: one or more services also failed to restart on the restored release." >&2
  fail "release $commit failed collector restart health and was rolled back"
fi

prune_superseded_releases "$release" "$previous_target"

echo
echo "Deployed OpsCenter commit $commit"
echo "Live path: $APP_LINK -> $release"
if [[ -n "$active_label" ]]; then
  echo "Service:   $active_label"
  echo "Health:    http://127.0.0.1:$active_port/login returned HTTP 200"
else
  echo "Service:   no OpsCenter launch service is loaded; release is prepared but not running"
fi
if (( ${#RESTARTED_SERVICE_LABELS[@]} > 0 )); then
  echo "Restarted: ${RESTARTED_SERVICE_LABELS[*]}"
fi
