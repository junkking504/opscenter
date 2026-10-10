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
source "$SCRIPT_DIR/release-services.sh"
REQUESTED_REF="${1:-}"
RESTART_WHATSAPP_PHOTO_WORKER="${OPSCENTER_RESTART_WHATSAPP_PHOTO_WORKER:-true}"
RELEASE_SERVICE_RESTART_TIMEOUT_SECONDS="${OPSCENTER_SERVICE_RESTART_TIMEOUT_SECONDS:-20}"
PRODUCTION_REF="refs/remotes/origin/production"
DEPLOY_LOCK_DIR="$DEPLOY_ROOT/.deploy-lock"
DEPLOY_LOCK_HELD=false
ACTIVE_DEPLOY_CHILD=""
DEPLOYMENT_HISTORY="$SHARED_CONFIG/deployment-history.tsv"
RESTARTED_SERVICE_LABELS=()

fail() {
  echo "Mission Control deployment stopped: $*" >&2
  exit 1
}

release_deploy_lock() {
  $DEPLOY_LOCK_HELD || return 0
  if [[ -n "$ACTIVE_DEPLOY_CHILD" ]] && kill -0 "$ACTIVE_DEPLOY_CHILD" 2>/dev/null; then
    echo "Deployment child remains live; preserving the global lock for recovery." >&2
    return 0
  fi
  rm -f "$DEPLOY_LOCK_DIR/owner"
  rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
  DEPLOY_LOCK_HELD=false
}

acquire_deploy_lock() {
  if ! mkdir "$DEPLOY_LOCK_DIR" 2>/dev/null; then
    lock_owner="$(<"$DEPLOY_LOCK_DIR/owner" 2>/dev/null || true)"
    [[ -n "$lock_owner" ]] || lock_owner="owner unavailable"
    if [[ -f "$DEPLOY_ROOT/.release-slots/transaction.json" || -f "$DEPLOY_ROOT/.release-slots/bootstrap.json" ]] \
      && node "$SCRIPT_DIR/release-transaction.mjs" recover-lock; then
      mkdir "$DEPLOY_LOCK_DIR" 2>/dev/null || fail "another owner acquired the recovered deployment lock"
    else
      fail "another deployment is running or its state needs review ($lock_owner); refusing to race it"
    fi
  fi
  DEPLOY_LOCK_HELD=true
  {
    echo "pid=$$"
    echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "requested_ref=$REQUESTED_REF"
  } > "$DEPLOY_LOCK_DIR/owner"
}

require_production_head() {
  local requested_commit="$1"
  local details

  if ! details="$(opscenter_require_exact_ref "$REPOSITORY" "$requested_commit" "$PRODUCTION_REF" 2>&1)"; then
    fail "$details"
  fi
}

require_forward_deploy() {
  local active_commit="$1"
  local requested_commit="$2"
  local context="$3"
  local details

  if ! details="$(opscenter_require_forward_commit "$REPOSITORY" "$active_commit" "$requested_commit" 2>&1)"; then
    fail "$context: $details; merge the active release into origin/production first"
  fi
}

trap release_deploy_lock EXIT

activate_release() {
  local release="$1"
  local next_link="$DEPLOY_ROOT/.opscenter-next-$$"
  rm -f "$next_link"
  ln -s "$release" "$next_link"
  /bin/mv -fh "$next_link" "$APP_LINK"
}

prune_superseded_releases() {
  # Cleanup failure must preserve files and report itself, not roll back a
  # healthy application. The helper shares this deployment's lock.
  python3 "$SCRIPT_DIR/workspace-retention.py" --apply --scope production \
    --deployment-owner "$$" --protect "$1" --protect "$2" \
    || echo "Workspace retention needs attention; see the cleanup error above." >&2
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

[[ -n "$REQUESTED_REF" ]] || fail "usage: $0 <pushed-git-ref-or-commit>"
[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ "$RELEASE_SERVICE_RESTART_TIMEOUT_SECONDS" == <-> && "$RELEASE_SERVICE_RESTART_TIMEOUT_SECONDS" -ge 1 ]] || fail "OPSCENTER_SERVICE_RESTART_TIMEOUT_SECONDS must be a positive integer"
[[ -d "$REPOSITORY/.git" ]] || fail "run deploy/macmini/bootstrap-git-deployment.sh first"
[[ -d "$DATA_DIR" ]] || fail "missing authoritative OpsBot data: $DATA_DIR"
[[ -L "$APP_LINK" ]] || fail "$APP_LINK must be a symbolic link; run the Git bootstrap first"

for command in git node npm curl launchctl lsof python3; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

mkdir -p "$RELEASES_DIR" "$SHARED_LOGS" "$SHARED_CONFIG"
acquire_deploy_lock
SLOT_MODE="legacy"
if [[ -e "$DEPLOY_ROOT/.release-slots" ]]; then
  SLOT_MODE="$(node "$SCRIPT_DIR/origin-state.mjs" mode "$DEPLOY_ROOT/.release-slots")" || fail "deployment mode unavailable; refusing"
fi
case "$SLOT_MODE" in
  legacy|slots|bootstrap-incomplete) ;;
  *) fail "deployment mode unreadable; refusing" ;;
esac
if [[ "$SLOT_MODE" == slots ]]; then
  node "$SCRIPT_DIR/release-transaction.mjs" recover unused "$$" &
  ACTIVE_DEPLOY_CHILD=$!
  wait "$ACTIVE_DEPLOY_CHILD"
  ACTIVE_DEPLOY_CHILD=""
elif [[ "$SLOT_MODE" == bootstrap-incomplete ]]; then
  fail "first-time proxy bootstrap requires reconciliation before a routine deployment"
fi
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
# The reviewed gate lives outside this release and cannot be replaced by a branch.
node "$HOME/Library/Application Support/OpsCenter/deployment-control/verify-spending-boundary.mjs" "$release"
npm ci
npx playwright install chromium

active_label=""
active_port=""
if [[ "$SLOT_MODE" == slots ]]; then
  active_label="com.openclaw.opscenter.origin-proxy"
  active_port="3000"
  npm run build &
  ACTIVE_DEPLOY_CHILD=$!
  wait "$ACTIVE_DEPLOY_CHILD"
  ACTIVE_DEPLOY_CHILD=""
elif service_loaded "$PRODUCTION_LABEL"; then
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

git -C "$REPOSITORY" fetch --prune origin
require_production_head "$commit"
latest_active_release="$(readlink "$APP_LINK")"
[[ -n "$latest_active_release" ]] || fail "cannot recheck the active OpsCenter release"
latest_active_commit="$(git -C "$latest_active_release" rev-parse --verify HEAD 2>/dev/null || true)"
[[ -n "$latest_active_commit" ]] || fail "cannot resolve the active commit during the final deployment check"
require_forward_deploy "$latest_active_commit" "$commit" "active release changed during build"

previous_target="$(readlink "$APP_LINK")"
if [[ "$SLOT_MODE" == slots ]]; then
  node "$SCRIPT_DIR/release-transaction.mjs" deploy "$commit" "$$" &
  ACTIVE_DEPLOY_CHILD=$!
  wait "$ACTIVE_DEPLOY_CHILD"
  ACTIVE_DEPLOY_CHILD=""
else
activate_release "$release"

if [[ -n "$active_label" ]]; then
  launchctl kickstart -k "gui/$(id -u)/$active_label"
  if ! wait_for_login "$active_port"; then
    echo "New release did not become healthy; restoring $previous_target" >&2
    restore_previous_release "$previous_target" "$active_label" "$active_port"
    fail "release $commit failed its login health check and was rolled back"
  fi
fi

if ! restart_release_bound_services "$release"; then
  echo "A release-bound service could not restart; restoring $previous_target" >&2
  restore_previous_release "$previous_target" "$active_label" "$active_port"
  RESTARTED_SERVICE_LABELS=()
  restart_release_bound_services "$previous_target" \
    || echo "WARNING: one or more services also failed to restart on the restored release." >&2
  fail "release $commit failed collector restart health and was rolled back"
fi

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
echo "Recovery:  automatic health rollback target was $previous_target"

if ! printf '%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$latest_active_commit" \
  "$commit" \
  "forward" >> "$DEPLOYMENT_HISTORY"; then
  echo "WARNING: deployment succeeded, but the transition could not be appended to $DEPLOYMENT_HISTORY" >&2
fi
