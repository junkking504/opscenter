#!/bin/zsh
set -euo pipefail

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
REPOSITORY="$EXPECTED_HOME/opscenter-v2/repository"
CONTROLLER_DIR="$EXPECTED_HOME/Library/Application Support/OpsCenter/deployment-control"
PRODUCTION_REF="refs/remotes/origin/production"
REQUESTED_REF="${1:-}"

fail() {
  echo "Production deployment controller installation stopped: $*" >&2
  exit 1
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ -n "$REQUESTED_REF" ]] || fail "usage: $0 <origin-production-commit>"
[[ -d "$REPOSITORY/.git" ]] || fail "missing Mission Control Git repository: $REPOSITORY"

git -C "$REPOSITORY" fetch --prune origin
commit="$(git -C "$REPOSITORY" rev-parse --verify "${REQUESTED_REF}^{commit}" 2>/dev/null || true)"
[[ -n "$commit" ]] || fail "cannot resolve $REQUESTED_REF after fetching origin"
production_commit="$(git -C "$REPOSITORY" rev-parse --verify "${PRODUCTION_REF}^{commit}" 2>/dev/null || true)"
[[ -n "$production_commit" ]] || fail "origin/production does not exist"
[[ "$commit" == "$production_commit" ]] \
  || fail "requested controller commit $commit is not the current origin/production commit $production_commit"

DEPLOY_LOCK_DIR="$EXPECTED_HOME/opscenter-v2/.deploy-lock"
mkdir "$DEPLOY_LOCK_DIR" 2>/dev/null || fail "another deployment or cleanup is running"
echo "pid=$$" > "$DEPLOY_LOCK_DIR/owner"
release_install_lock() {
  rm -f "$DEPLOY_LOCK_DIR/owner"
  rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
}
trap release_install_lock EXIT

# A running proxy must never silently change code on its next KeepAlive restart.
# Subsequent controller changes need a separately reviewed proxy reload plan.
if [[ -d "$EXPECTED_HOME/opscenter-v2/.release-slots" ]]; then
  installed_mode="$(node "$CONTROLLER_DIR/origin-state.mjs" mode "$EXPECTED_HOME/opscenter-v2/.release-slots")"
  [[ "$installed_mode" == legacy ]] || fail "slot mode or bootstrap is active; a separately reviewed proxy reload plan is required before controller replacement"
fi

mkdir -p "$CONTROLLER_DIR"
bundle_installer="$CONTROLLER_DIR/.install-controller-bundle.$$"
git -C "$REPOSITORY" show "${commit}:deploy/macmini/install-controller-bundle.py" > "$bundle_installer"
python3 "$bundle_installer" "$REPOSITORY" "$CONTROLLER_DIR" "$commit"
/bin/rm -f "$bundle_installer"

instructions="$CONTROLLER_DIR/.workspace-lifecycle.new.$$"
git -C "$REPOSITORY" show "${commit}:deploy/macmini/workspace-lifecycle.md" > "$instructions"
python3 - "$EXPECTED_HOME/opscenter-v2/AGENTS.md" "$instructions" <<'PY'
from pathlib import Path
import sys
target, source = map(Path, sys.argv[1:])
start = '<!-- BEGIN OPSCENTER STORAGE LIFECYCLE -->'
end = '<!-- END OPSCENTER STORAGE LIFECYCLE -->'
if target.is_symlink():
    raise SystemExit('Refusing to replace a symbolic-link AGENTS.md')
original = target.read_text() if target.exists() else '# OpsCenter workspace instructions\n'
block = source.read_text().strip()
if original.count(start) != original.count(end) or original.count(start) > 1:
    raise SystemExit('Workspace lifecycle markers need review')
if start in original:
    a, b = original.index(start), original.index(end) + len(end)
    updated = original[:a] + block + original[b:]
else:
    updated = original.rstrip() + '\n\n' + block + '\n'
target.write_text(updated)
PY
/bin/rm -f "$instructions"

installation_record="$CONTROLLER_DIR/.installation.txt.new.$$"
{
  echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source_commit=$commit"
  echo "deploy_release_sha256=$(shasum -a 256 "$CONTROLLER_DIR/deploy-release.sh" | awk '{print $1}')"
  echo "lineage_sha256=$(shasum -a 256 "$CONTROLLER_DIR/release-lineage.sh" | awk '{print $1}')"
  echo "retention_sha256=$(shasum -a 256 "$CONTROLLER_DIR/workspace-retention.py" | awk '{print $1}')"
} > "$installation_record"
/bin/chmod 0444 "$installation_record"
/bin/mv -f "$installation_record" "$CONTROLLER_DIR/installation.txt"

echo "Installed the Mission Control production deployment controller."
echo "Controller: $CONTROLLER_DIR/deploy-release.sh"
echo "This installation did not build, activate, restart, or deploy OpsCenter."
