#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
DEPLOY_ROOT="$EXPECTED_HOME/opscenter-v2"
PRODUCTION_LINK="$DEPLOY_ROOT/opscenter"
PREVIEW_LINK="$DEPLOY_ROOT/opscenter-preview"
REPOSITORY="$DEPLOY_ROOT/repository"
PREVIEW_RELEASES_DIR="$DEPLOY_ROOT/preview-releases"
SHARED_LOGS="$EXPECTED_HOME/Library/Logs/OpsCenter"
SHARED_CONFIG="$EXPECTED_HOME/Library/Application Support/OpsCenter"
PREVIEW_ENV="$SHARED_CONFIG/macmini-preview.env"
DATA_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/data"
PRODUCTION_LABEL="com.openclaw.opscenter"
PREVIEW_LABEL="com.openclaw.opscenter.macmini-preview"
INSTALLED_PREVIEW_PLIST="$EXPECTED_HOME/Library/LaunchAgents/com.openclaw.opscenter.macmini-preview.plist"
REQUESTED_REF="${1:-}"
ACTIVATED=false
PREVIOUS_PREVIEW_TARGET=""
PRODUCTION_TARGET=""

fail() {
  echo "Mission Control preview deployment stopped: $*" >&2
  exit 1
}

load_environment_file() {
  local file="$1"
  local config_line
  while IFS= read -r config_line || [[ -n "$config_line" ]]; do
    [[ -z "$config_line" || "$config_line" == \#* ]] && continue
    [[ "$config_line" =~ '^[A-Za-z_][A-Za-z0-9_]*=' ]] || fail "invalid environment entry in $file"
    export "$config_line"
  done < "$file"
}

service_loaded() {
  launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1
}

activate_preview_release() {
  local release="$1"
  local next_link="$DEPLOY_ROOT/.opscenter-preview-next-$$"
  rm -f "$next_link"
  ln -s "$release" "$next_link"
  /bin/mv -fh "$next_link" "$PREVIEW_LINK"
}

load_preview_service() {
  local attempt=1
  launchctl bootout "gui/$(id -u)/$PREVIEW_LABEL" >/dev/null 2>&1 || true
  # launchd may keep the prior label reserved briefly after bootout. Give the
  # unload time to settle before beginning bounded bootstrap retries.
  sleep 2
  while (( attempt <= 5 )); do
    if launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PREVIEW_PLIST" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

wait_for_runtime() {
  local port="$1"
  local expected_runtime="$2"
  local allowed_login="$3"
  local attempt=1
  local http_status
  local health_payload
  while (( attempt <= 20 )); do
    http_status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/login" || true)"
    health_payload="$(curl -sS --max-time 5 "http://127.0.0.1:$port/api/health" || true)"
    if [[ "$http_status" == ${~allowed_login} && "$health_payload" == *"\"runtime\":\"$expected_runtime\""* ]]; then
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  return 1
}

production_unchanged() {
  [[ -L "$PRODUCTION_LINK" && "$(readlink "$PRODUCTION_LINK")" == "$PRODUCTION_TARGET" ]]
}

rollback_preview() {
  if $ACTIVATED && [[ -n "$PREVIOUS_PREVIEW_TARGET" && -d "$PREVIOUS_PREVIEW_TARGET" ]]; then
    echo "Restoring previous preview release: $PREVIOUS_PREVIEW_TARGET" >&2
    activate_preview_release "$PREVIOUS_PREVIEW_TARGET"
    load_preview_service || true
    wait_for_runtime 3100 "MAC_MINI_PREVIEW" "200|307" || true
  fi
}

deployment_exit() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    rollback_preview
    if ! production_unchanged; then
      echo "CRITICAL: production link changed during preview deployment" >&2
    fi
  fi
}

[[ -n "$REQUESTED_REF" ]] || fail "usage: $0 <pushed-git-ref-or-commit>"
[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ -d "$REPOSITORY/.git" ]] || fail "run deploy/macmini/bootstrap-git-deployment.sh first"
[[ -d "$DATA_DIR" ]] || fail "missing authoritative OpsBot data: $DATA_DIR"
[[ -L "$PRODUCTION_LINK" ]] || fail "$PRODUCTION_LINK must remain the production release symlink"
[[ -f "$PREVIEW_ENV" ]] || fail "missing protected preview environment"
[[ "$(stat -f '%Lp' "$PREVIEW_ENV")" == "600" ]] || fail "preview environment mode must be 600"
service_loaded "$PRODUCTION_LABEL" || fail "production OpsCenter service must be loaded"
service_loaded "$PREVIEW_LABEL" || fail "preview OpsCenter service must be loaded"

for command in git node npm curl launchctl plutil; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

PRODUCTION_TARGET="$(readlink "$PRODUCTION_LINK")"
[[ -d "$PRODUCTION_TARGET" ]] || fail "production link target is missing"
wait_for_runtime 3000 "MISSION_CONTROL" "200" || fail "production runtime is not healthy enough for a preview deployment"

if [[ -L "$PREVIEW_LINK" ]]; then
  PREVIOUS_PREVIEW_TARGET="$(readlink "$PREVIEW_LINK")"
  [[ -d "$PREVIOUS_PREVIEW_TARGET" ]] || fail "preview link target is missing"
elif [[ -e "$PREVIEW_LINK" ]]; then
  fail "$PREVIEW_LINK exists but is not a symbolic link"
else
  PREVIOUS_PREVIEW_TARGET="$PRODUCTION_TARGET"
fi

mkdir -p "$PREVIEW_RELEASES_DIR" "$SHARED_LOGS" "$SHARED_CONFIG" "$EXPECTED_HOME/Library/LaunchAgents"
git -C "$REPOSITORY" fetch --prune origin

commit="$(git -C "$REPOSITORY" rev-parse --verify "${REQUESTED_REF}^{commit}" 2>/dev/null || true)"
[[ -n "$commit" ]] || fail "cannot resolve $REQUESTED_REF after fetching origin"
remote_containers="$(git -C "$REPOSITORY" for-each-ref --format='%(refname)' --contains "$commit" refs/remotes/origin)"
[[ -n "$remote_containers" ]] || fail "commit $commit is not contained in a pushed origin branch"

release="$PREVIEW_RELEASES_DIR/$commit"
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
NEXT_DIST_DIR="tmp/macmini-preview-next" npm run build

load_environment_file "$PREVIEW_ENV"
export OPSCENTER_RUNTIME="MAC_MINI_PREVIEW"
npm run platform:migrate

{
  echo "commit=$commit"
  echo "target=preview"
  echo "deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$release/.opscenter-release"

source_plist="$release/deploy/macmini/launchd/com.openclaw.opscenter.macmini-preview.plist"
plutil -lint "$source_plist"
/usr/bin/install -m 644 "$source_plist" "$INSTALLED_PREVIEW_PLIST"

production_unchanged || fail "production link changed before preview activation"
trap deployment_exit EXIT
activate_preview_release "$release"
ACTIVATED=true
load_preview_service || fail "preview service could not be loaded"
wait_for_runtime 3100 "MAC_MINI_PREVIEW" "200|307" || fail "preview release failed its runtime check"
production_unchanged || fail "production link changed during preview activation"
wait_for_runtime 3000 "MISSION_CONTROL" "200" || fail "production runtime changed during preview deployment"
"$PREVIEW_LINK/deploy/macmini/verify-coexistence.sh" --require-preview-kernel

trap - EXIT

echo
echo "Deployed OpsCenter preview commit $commit"
echo "Preview path: $PREVIEW_LINK -> $release"
echo "Preview URL:  http://127.0.0.1:3100"
echo "Production:   $PRODUCTION_LINK -> $PRODUCTION_TARGET (unchanged)"
echo "Rollback:     deploy the previous preview commit again: $PREVIOUS_PREVIEW_TARGET"
