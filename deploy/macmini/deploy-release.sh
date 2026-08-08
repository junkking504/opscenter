#!/bin/zsh
set -euo pipefail

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
DEPLOY_ROOT="$EXPECTED_HOME/opscenter-v2"
APP_LINK="$DEPLOY_ROOT/opscenter"
REPOSITORY="$DEPLOY_ROOT/repository"
RELEASES_DIR="$DEPLOY_ROOT/releases"
SHARED_LOGS="$EXPECTED_HOME/Library/Logs/OpsCenter"
DATA_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/data"
PRODUCTION_LABEL="com.openclaw.opscenter"
PREVIEW_LABEL="com.openclaw.opscenter.macmini-preview"
REQUESTED_REF="${1:-}"

fail() {
  echo "Mission Control deployment stopped: $*" >&2
  exit 1
}

service_loaded() {
  launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1
}

activate_release() {
  local release="$1"
  local next_link="$DEPLOY_ROOT/.opscenter-next-$$"
  rm -f "$next_link"
  ln -s "$release" "$next_link"
  /bin/mv -fh "$next_link" "$APP_LINK"
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

[[ -n "$REQUESTED_REF" ]] || fail "usage: $0 <pushed-git-ref-or-commit>"
[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ -d "$REPOSITORY/.git" ]] || fail "run deploy/macmini/bootstrap-git-deployment.sh first"
[[ -d "$DATA_DIR" ]] || fail "missing authoritative OpsBot data: $DATA_DIR"
[[ -L "$APP_LINK" ]] || fail "$APP_LINK must be a symbolic link; run the Git bootstrap first"

for command in git node npm curl launchctl; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

mkdir -p "$RELEASES_DIR" "$SHARED_LOGS"
git -C "$REPOSITORY" fetch --prune origin

commit="$(git -C "$REPOSITORY" rev-parse --verify "${REQUESTED_REF}^{commit}" 2>/dev/null || true)"
[[ -n "$commit" ]] || fail "cannot resolve $REQUESTED_REF after fetching origin"

remote_containers="$(git -C "$REPOSITORY" for-each-ref --format='%(refname)' --contains "$commit" refs/remotes/origin)"
[[ -n "$remote_containers" ]] || fail "commit $commit is not contained in a pushed origin branch"

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

cd "$release"
npm ci

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

echo
echo "Deployed OpsCenter commit $commit"
echo "Live path: $APP_LINK -> $release"
if [[ -n "$active_label" ]]; then
  echo "Service:   $active_label"
  echo "Health:    http://127.0.0.1:$active_port/login returned HTTP 200"
else
  echo "Service:   no OpsCenter launch service is loaded; release is prepared but not running"
fi
echo "Rollback:  deploy this previous target's commit again: $previous_target"
