#!/bin/zsh
# One-command release: ship <PR number> [--dry-run]
# Checks the PR, merges it with a merge commit, and deploys the resulting
# origin/production head through the installed release controller (which
# builds first, health-checks, and restores the prior release on failure).
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="${0:A:h}"
REPOSITORY_ROOT="${SCRIPT_DIR:h:h}"
ACTIVE_RELEASE="/Users/missioncontrol/opscenter-v2/opscenter"
PR="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true

fail() { echo "ship stopped: $*" >&2; exit 1; }
[[ "$PR" =~ ^[0-9]+$ ]] || fail "usage: ship.sh <PR number> [--dry-run]"
[[ $# -le 2 && ( $# -lt 2 || "$2" == "--dry-run" ) ]] || fail "usage: ship.sh <PR number> [--dry-run]"
command -v gh >/dev/null || fail "gh CLI not found"
[[ -d "$ACTIVE_RELEASE" ]] || fail "run on Mission Control with the active release"
cd "$REPOSITORY_ROOT"

json=$(gh pr view "$PR" --json state,baseRefName,mergeable,isDraft,labels,statusCheckRollup,headRefOid)
field() { print -r -- "$json" | python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

[[ "$(field 'd["state"]')" == "OPEN" ]] || fail "PR #$PR is not open"
[[ "$(field 'd["baseRefName"]')" == "production" ]] || fail "PR #$PR does not target production"
[[ "$(field 'd["isDraft"]')" == "False" ]] || fail "PR #$PR is a draft"
[[ "$(field 'd["mergeable"]')" == "MERGEABLE" ]] || fail "PR #$PR has conflicts or is not mergeable yet"
[[ "$(field '[l["name"] for l in d["labels"]].count("claude-stop")')" == "0" ]] \
  || fail "Claude's review says stop (label claude-stop). Fix it or remove the label."
bad=$(field 'len([c for c in d["statusCheckRollup"] if (c.get("conclusion") or c.get("state")) not in ("SUCCESS","NEUTRAL","SKIPPED")])')
[[ "$bad" == "0" ]] || fail "CI is not fully green ($bad checks pending or failing)"

head_sha=$(field 'd["headRefOid"]')
[[ "$head_sha" =~ ^[0-9a-f]{40}$ ]] || fail "invalid PR head"
git fetch origin production
git fetch origin "refs/pull/$PR/head"
[[ "$(git rev-parse FETCH_HEAD)" == "$head_sha" ]] || fail "PR head changed; retry against the new head"
active_sha=$(git -C "$ACTIVE_RELEASE" rev-parse HEAD)
git merge-base --is-ancestor "$active_sha" "$head_sha" || fail "PR must contain the active release"
git merge-base --is-ancestor origin/production "$head_sha" || fail "merge current production into the PR and rerun validation first"

echo "PR #$PR ready: current production included, CI green; review receipts are optional."
if $DRY_RUN; then echo "dry run: would merge (merge commit) and deploy origin/production."; exit 0; fi

gh pr merge "$PR" --merge --match-head-commit "$head_sha"
git fetch origin production
sha=$(git rev-parse origin/production)
echo "Deploying $sha"
export OPSCENTER_MC_HOST=127.0.0.1
exec "$SCRIPT_DIR/deploy-from-macbook.sh" origin/production
