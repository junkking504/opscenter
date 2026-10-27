#!/bin/zsh
# One-command release: ship <PR number> [--dry-run]
# Checks the PR, merges it with a merge commit, and deploys the resulting
# origin/production head through the installed release controller (which
# builds first, health-checks, and restores the prior release on failure).
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

CONTROLLER="${OPSCENTER_CONTROLLER:-/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control/deploy-release.sh}"
PR="${1:-}"
DRY_RUN=false
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true

fail() { echo "ship stopped: $*" >&2; exit 1; }
[[ "$PR" =~ ^[0-9]+$ ]] || fail "usage: ship.sh <PR number> [--dry-run]"
command -v gh >/dev/null || fail "gh CLI not found"

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

echo "PR #$PR ready: open, mergeable, CI green, no stop label."
if $DRY_RUN; then echo "dry run: would merge (merge commit) and deploy origin/production."; exit 0; fi

gh pr merge "$PR" --merge
git fetch origin production
sha=$(git rev-parse origin/production)
echo "Deploying $sha"
exec "$CONTROLLER" "$sha"
