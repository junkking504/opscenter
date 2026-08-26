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

mkdir -p "$CONTROLLER_DIR"
for source_name in deploy-release.sh release-lineage.sh; do
  destination="$CONTROLLER_DIR/$source_name"
  temporary="$CONTROLLER_DIR/.${source_name}.new.$$"
  git -C "$REPOSITORY" show "${commit}:deploy/macmini/$source_name" > "$temporary" \
    || fail "commit $commit does not contain deploy/macmini/$source_name"
  /bin/zsh -n "$temporary"
  /bin/chmod 0555 "$temporary"
  /bin/mv -f "$temporary" "$destination"
done

installation_record="$CONTROLLER_DIR/.installation.txt.new.$$"
{
  echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "source_commit=$commit"
  echo "deploy_release_sha256=$(shasum -a 256 "$CONTROLLER_DIR/deploy-release.sh" | awk '{print $1}')"
  echo "lineage_sha256=$(shasum -a 256 "$CONTROLLER_DIR/release-lineage.sh" | awk '{print $1}')"
} > "$installation_record"
/bin/chmod 0444 "$installation_record"
/bin/mv -f "$installation_record" "$CONTROLLER_DIR/installation.txt"

echo "Installed the Mission Control production deployment controller."
echo "Controller: $CONTROLLER_DIR/deploy-release.sh"
echo "This installation did not build, activate, restart, or deploy OpsCenter."
