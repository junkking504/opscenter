#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPOSITORY_ROOT="${SCRIPT_DIR:h}"
source "$REPOSITORY_ROOT/deploy/macmini/release-lineage.sh"

deployer="$REPOSITORY_ROOT/deploy/macmini/deploy-release.sh"
wrapper="$REPOSITORY_ROOT/deploy/macmini/deploy-from-macbook.sh"
installer="$REPOSITORY_ROOT/deploy/macmini/install-production-release-controller.sh"

grep -F 'PRODUCTION_REF="refs/remotes/origin/production"' "$deployer" >/dev/null
grep -F 'require_production_head "$commit"' "$deployer" >/dev/null
grep -F 'require_forward_deploy "$active_commit" "$commit" "initial ancestry check"' "$deployer" >/dev/null
grep -F 'require_forward_deploy "$latest_active_commit" "$commit" "active release changed during build"' "$deployer" >/dev/null
grep -F 'acquire_deploy_lock' "$deployer" >/dev/null
grep -F '[[ -n "$watcher_label" ]] || continue' "$deployer" >/dev/null
grep -F 'REMOTE_CONTROLLER="/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control/deploy-release.sh"' "$wrapper" >/dev/null
grep -F 'ssh "${ssh_options[@]}" "$ssh_target" /bin/zsh -s -- "$commit"' "$wrapper" >/dev/null
grep -F 'controller="/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control/deploy-release.sh"' "$wrapper" >/dev/null
grep -F 'exec /bin/zsh "$controller" "$commit"' "$wrapper" >/dev/null
grep -F 'requested controller commit $commit is not the current origin/production commit $production_commit' "$installer" >/dev/null
if grep -F '< "$SCRIPT_DIR/deploy-release.sh"' "$wrapper" >/dev/null; then
  echo "MacBook wrapper must not stream a branch-local deploy controller" >&2
  exit 1
fi

fixture_root="$(mktemp -d /tmp/opscenter-release-gate-test.XXXXXX)"
cleanup() {
  if [[ -n "${fixture_root:-}" && "$fixture_root" == /tmp/opscenter-release-gate-test.* ]]; then
    rm -rf -- "$fixture_root"
  fi
}
trap cleanup EXIT

git -C "$fixture_root" init -q
git -C "$fixture_root" config user.name "OpsCenter Gate Test"
git -C "$fixture_root" config user.email "gate-test@example.invalid"

touch "$fixture_root/base"
git -C "$fixture_root" add base
git -C "$fixture_root" commit -qm base
base_commit="$(git -C "$fixture_root" rev-parse HEAD)"

git -C "$fixture_root" branch production
touch "$fixture_root/forward"
git -C "$fixture_root" add forward
git -C "$fixture_root" commit -qm forward
forward_commit="$(git -C "$fixture_root" rev-parse HEAD)"
git -C "$fixture_root" branch -f production "$forward_commit"

git -C "$fixture_root" switch -q --detach "$base_commit"
touch "$fixture_root/sibling"
git -C "$fixture_root" add sibling
git -C "$fixture_root" commit -qm sibling
sibling_commit="$(git -C "$fixture_root" rev-parse HEAD)"

opscenter_require_forward_commit "$fixture_root" "$base_commit" "$forward_commit"
if opscenter_require_forward_commit "$fixture_root" "$forward_commit" "$sibling_commit" 2>/dev/null; then
  echo "sibling branch unexpectedly passed the forward-only check" >&2
  exit 1
fi

opscenter_require_exact_ref "$fixture_root" "$forward_commit" refs/heads/production
if opscenter_require_exact_ref "$fixture_root" "$sibling_commit" refs/heads/production 2>/dev/null; then
  echo "non-production commit unexpectedly passed the exact-ref check" >&2
  exit 1
fi

echo "Production release lineage gate tests passed."
