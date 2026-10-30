#!/bin/zsh
# Ship the oldest eligible ready-to-ship PR through ship.sh and the installed
# controller. Waiting candidates do not block later PRs. Never run tests live.
set -euo pipefail

export PATH="${AUTO_SHIP_EXTRA_PATH:+$AUTO_SHIP_EXTRA_PATH:}/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
CONFIG_DIR="${AUTO_SHIP_CONFIG_DIR:-/Users/missioncontrol/Library/Application Support/OpsCenter}"
SHIP_WORKTREE="${AUTO_SHIP_WORKTREE:-/Users/missioncontrol/opscenter-v2/worktrees/ship}"
DEPLOY_LOCK="${AUTO_SHIP_DEPLOY_LOCK:-/Users/missioncontrol/opscenter-v2/.deploy-lock}"
MIN_INTERVAL="${AUTO_SHIP_MIN_INTERVAL_SECONDS:-3600}"
LABEL="ready-to-ship"
STAMP="$CONFIG_DIR/auto-ship.last"
LOG="$CONFIG_DIR/auto-ship.log"
LOCK="$CONFIG_DIR/auto-ship.lock"
INFLIGHT="$CONFIG_DIR/auto-ship.inflight"

# Parse the entire function before refreshing the checkout containing this file.
main() {
  mkdir -p "$CONFIG_DIR"
  log() { printf "%s\n" "$(date -u +%FT%TZ) $*" >> "$LOG"; }
  [[ "$MIN_INTERVAL" == <-> ]] || { log "invalid cooldown seconds"; exit 1; }
  mkdir "$LOCK" 2>/dev/null || { log "scheduler lock exists or cannot be acquired; if persistent, reconcile $LOCK"; exit 0; }
  trap 'rmdir "$LOCK"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP

  # Check shared state only after owning the lock; another run may just have
  # finished. Unknown outcomes require reconciliation, never automatic replay.
  [[ -e "$CONFIG_DIR/auto-ship.off" || -e "$DEPLOY_LOCK" ]] && exit 0
  if [[ -e "$INFLIGHT" ]]; then
    log "release outcome needs reconciliation: $INFLIGHT"
    exit 1
  fi
  if [[ -f "$STAMP" ]]; then
    remaining=$(python3 - "$STAMP" "$MIN_INTERVAL" <<'PY'
import os, sys, time
print(max(0, float(sys.argv[2]) - (time.time() - os.stat(sys.argv[1]).st_mtime)))
PY
)
    (( remaining > 0 )) && exit 0
  fi

  # launchd need not start in a repository. All gh commands use this checkout.
  cd "$SHIP_WORKTREE" || { log "cannot enter $SHIP_WORKTREE"; exit 1; }
  prs=$(gh pr list --base production --state open --label "$LABEL" --limit 1000 --json number,createdAt \
    --jq 'sort_by(.createdAt, .number) | .[].number') || { log "queue lookup failed"; exit 1; }
  [[ -n "$prs" ]] || exit 0
  # Do not carry local edits into a release script refresh.
  checkout_state=$(git status --porcelain)
  [[ -z "$checkout_state" ]] || { log "ship checkout is dirty; refusing refresh"; exit 1; }
  git fetch origin production
  git checkout --detach origin/production

  for candidate in ${(f)prs}; do
    [[ "$candidate" == <-> ]] || { log "invalid PR number from queue"; exit 1; }
    [[ -e "$CONFIG_DIR/auto-ship.off" || -e "$DEPLOY_LOCK" ]] && exit 0
    log "checking PR #$candidate"
    print -r -- "PR #$candidate started $(date -u +%FT%TZ); reconcile before removing this file" > "$INFLIGHT"
    # `status` is read-only in zsh. Capture failures without disabling errexit
    # for bookkeeping, and keep the marker if we cannot finish bookkeeping.
    rc=0
    output=$(deploy/macmini/ship.sh "$candidate" 2>&1) || rc=$?
    printf "%s\n" "$output" | tail -40 >> "$LOG"
    reason=$(printf "%s\n" "$output" | grep -E '^ship stopped:' | tail -1 || true)
    # These are pre-merge refusals from ship.sh. No release was attempted.
    if (( rc != 0 )) && [[ "$reason" == *"checks pending or failing)" || "$reason" == *"has conflicts or is not mergeable yet" ]]; then
      log "PR #$candidate not ready yet: $reason"
      rm "$INFLIGHT"
      continue
    fi

    # One terminal attempt per tick, including failures. Persist the cooldown
    # before remote bookkeeping; a failed label removal must not replay a PR.
    touch "$STAMP"
    gh pr edit "$candidate" --remove-label "$LABEL" >/dev/null || { log "PR #$candidate label removal failed; reconcile $INFLIGHT"; exit 1; }
    if (( rc == 0 )); then
      log "PR #$candidate shipped"
      gh pr comment "$candidate" --body "Auto-ship: merged and deployed. The controller's health check passed. $(git rev-parse --short origin/production)" >/dev/null \
        || log "PR #$candidate success comment failed"
    else
      merged=$(gh pr view "$candidate" --json state --jq .state) || merged="UNKNOWN"
      log "PR #$candidate failed (status $rc, state $merged): ${reason:-see log}"
      gh pr edit "$candidate" --add-label "ship-failed" >/dev/null || { log "PR #$candidate failure label failed; reconcile $INFLIGHT"; exit 1; }
      gh pr comment "$candidate" --body "Auto-ship stopped and removed the ready-to-ship label. ${reason:-Deployment did not finish.} PR state: $merged. Confirm the active release and controller log before retrying; a merged PR alone does not prove deployment or rollback. Log: auto-ship.log on Mission Control." >/dev/null \
        || log "PR #$candidate failure comment failed"
      # A failed release is safe to clear only when ship.sh explicitly refused
      # it before merging AND GitHub confirms the PR is still open. A merged,
      # unknown or unclassified failure can leave production ahead of the live
      # release. Keep the queue blocked until an operator reconciles that gap.
      if [[ "$merged" != "OPEN" || -z "$reason" ]]; then
        log "PR #$candidate outcome requires reconciliation; retaining $INFLIGHT"
        return 1
      fi
    fi
    rm "$INFLIGHT"
    return 0
  done
}
main "$@"
