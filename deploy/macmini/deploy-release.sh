#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

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
REQUESTED_REF="${1:-}"
RESTART_WHATSAPP_PHOTO_WORKER="${OPSCENTER_RESTART_WHATSAPP_PHOTO_WORKER:-true}"
RELEASE_RETENTION="${OPSCENTER_RELEASE_RETENTION:-8}"
ALLOW_NON_FORWARD="${2:-0}"
DEPLOY_LOCK_DIR="$DEPLOY_ROOT/.deploy-lock"
DEPLOY_LOCK_HELD=false

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

[[ -n "$REQUESTED_REF" ]] || fail "usage: $0 <pushed-git-ref-or-commit> [allow-non-forward: 0|1]"
[[ "$ALLOW_NON_FORWARD" == "0" || "$ALLOW_NON_FORWARD" == "1" ]] || fail "allow-non-forward must be 0 or 1"
[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ "$RELEASE_RETENTION" == <-> && "$RELEASE_RETENTION" -ge 3 ]] || fail "OPSCENTER_RELEASE_RETENTION must be an integer of at least 3"
[[ -d "$REPOSITORY/.git" ]] || fail "run deploy/macmini/bootstrap-git-deployment.sh first"
[[ -d "$DATA_DIR" ]] || fail "missing authoritative OpsBot data: $DATA_DIR"
[[ -L "$APP_LINK" ]] || fail "$APP_LINK must be a symbolic link; run the Git bootstrap first"

for command in git node npm curl launchctl; do
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

remote_containers="$(git -C "$REPOSITORY" for-each-ref --format='%(refname)' --contains "$commit" refs/remotes/origin)"
[[ -n "$remote_containers" ]] || fail "commit $commit is not contained in a pushed origin branch"

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
    activate_release "$previous_target"
    launchctl kickstart -k "gui/$(id -u)/$active_label"
    wait_for_login "$active_port" || true
    fail "release $commit failed its login health check and was rolled back"
  fi
fi

prune_superseded_releases "$release" "$previous_target"

if service_loaded "$WHATSAPP_PHOTO_LABEL" && whatsapp_photo_worker_restart_enabled; then
  launchctl kickstart -k "gui/$(id -u)/$WHATSAPP_PHOTO_LABEL"
fi

# The collector's executable path is the stable active-release symlink, but its
# launchd policy is an installed copy. Refresh that copy on every deployment
# when the dedicated collector is already enabled so retry/KeepAlive changes in
# the new release take effect instead of silently leaving an older policy live.
if service_loaded "$LINXUP_COLLECTOR_LABEL"; then
  "$release/deploy/macmini/install-linxup-collector.sh"
fi

echo
echo "Deployed OpsCenter commit $commit"
echo "Live path: $APP_LINK -> $release"
if [[ -n "$active_label" ]]; then
  echo "Service:   $active_label"
  echo "Health:    http://127.0.0.1:$active_port/login returned HTTP 200"
else
  echo "Service:   no OpsCenter launch service is loaded; release is prepared but not running"
fi
if service_loaded "$WHATSAPP_PHOTO_LABEL" && whatsapp_photo_worker_restart_enabled; then
  echo "Worker:    $WHATSAPP_PHOTO_LABEL restarted on the active release"
fi
if service_loaded "$LINXUP_COLLECTOR_LABEL"; then
  echo "Collector: $LINXUP_COLLECTOR_LABEL reinstalled on the active release"
fi
echo "Rollback:  deploy this previous target's commit again: $previous_target"
