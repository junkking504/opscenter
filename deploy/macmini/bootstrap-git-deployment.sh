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
REPOSITORY_URL="${1:-https://github.com/junkking504/opscenter.git}"

fail() {
  echo "Mission Control Git bootstrap stopped: $*" >&2
  exit 1
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ -d "$DATA_DIR" ]] || fail "missing authoritative OpsBot data: $DATA_DIR"

for command in git node npm curl; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

mkdir -p "$DEPLOY_ROOT" "$RELEASES_DIR" "$SHARED_LOGS"

if [[ -e "$REPOSITORY" ]]; then
  [[ -d "$REPOSITORY/.git" ]] || fail "$REPOSITORY exists but is not a Git checkout"
  configured_url="$(git -C "$REPOSITORY" remote get-url origin 2>/dev/null || true)"
  [[ "$configured_url" == "$REPOSITORY_URL" ]] || fail "repository origin is $configured_url, expected $REPOSITORY_URL"
  git -C "$REPOSITORY" fetch --prune origin
else
  git clone "$REPOSITORY_URL" "$REPOSITORY"
fi

if [[ -L "$APP_LINK" ]]; then
  current_target="$(readlink "$APP_LINK")"
  [[ -e "$current_target" ]] || fail "$APP_LINK points to a missing target: $current_target"
elif [[ -d "$APP_LINK" ]]; then
  timestamp="$(date +%Y%m%d-%H%M%S)"
  snapshot="$DEPLOY_ROOT/pre-git-snapshot-$timestamp"
  [[ ! -e "$snapshot" ]] || fail "snapshot path already exists: $snapshot"
  mv "$APP_LINK" "$snapshot"
  ln -s "$snapshot" "$APP_LINK"
  echo "Preserved the existing application tree at $snapshot"
elif [[ -e "$APP_LINK" ]]; then
  fail "$APP_LINK exists but is neither a directory nor a symbolic link"
fi

echo
echo "Mission Control is ready for commit-based OpsCenter releases."
echo "Repository: $REPOSITORY"
echo "Releases:   $RELEASES_DIR"
echo "Live path:  $APP_LINK"
echo "Data:       $DATA_DIR"
echo
echo "No production service or tunnel was enabled by this bootstrap."
