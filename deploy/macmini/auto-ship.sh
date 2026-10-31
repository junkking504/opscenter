#!/bin/zsh
# Ship the oldest eligible ready-to-ship PR through ship.sh and the installed
# controller. Waiting candidates do not block later PRs. Never run tests live.
set -euo pipefail

export PATH="${AUTO_SHIP_EXTRA_PATH:+$AUTO_SHIP_EXTRA_PATH:}/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
CONFIG_DIR="${AUTO_SHIP_CONFIG_DIR:-/Users/missioncontrol/Library/Application Support/OpsCenter}"
SHIP_WORKTREE="${AUTO_SHIP_WORKTREE:-/Users/missioncontrol/opscenter-v2/worktrees/ship}"
DEPLOY_LOCK="${AUTO_SHIP_DEPLOY_LOCK:-/Users/missioncontrol/opscenter-v2/.deploy-lock}"
LABEL="ready-to-ship"
LOG="$CONFIG_DIR/auto-ship.log"
LOCK="$CONFIG_DIR/auto-ship.lock"
INFLIGHT="$CONFIG_DIR/auto-ship.inflight"
RETRY_SLEEP="${AUTO_SHIP_RETRY_SLEEP_SECONDS:-3}"

# Parse the entire function before refreshing the checkout containing this file.
main() {
  mkdir -p "$CONFIG_DIR"
  log() { printf "%s\n" "$(date -u +%FT%TZ) $*" >> "$LOG"; }
  # GitHub answers 5xx now and then. Retry bookkeeping calls before giving up.
  gh_retry() {
    local attempt
    for attempt in 1 2 3; do
      gh "$@" && return 0
      (( attempt < 3 )) && sleep "$RETRY_SLEEP"
    done
    return 1
  }
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
    before=$(git ls-remote origin refs/heads/production 2>/dev/null | cut -f1) || before=""
    rc=0
    output=$(deploy/macmini/ship.sh "$candidate" 2>&1) || rc=$?
    printf "%s\n" "$output" | tail -40 >> "$LOG"
    reason=$(printf "%s\n" "$output" | grep -E '^ship stopped:' | tail -1 || true)
    # These are pre-merge refusals from ship.sh. No release was attempted, and
    # each clears by itself: CI finishes, a conflict is resolved, or production
    # moves and the branch is updated. Keep the label and the cooldown untouched.
    if (( rc != 0 )) && [[ "$reason" == *"checks pending or failing)" || "$reason" == *"has conflicts or is not mergeable yet" || "$reason" == *"PR must contain the active release" || "$reason" == *"merge current production into the PR and review it first" || "$reason" == *"merge current production into the PR and rerun validation first" ]]; then
      log "PR #$candidate not ready yet: $reason"
      # Production moved under a labeled PR: merge it in ourselves (a plain
      # merge commit on the PR branch); the next tick ships it once CI is green.
      # A real conflict fails here and keeps waiting for its owner.
      if [[ "$reason" == *"PR must contain the active release" || "$reason" == *"merge current production into the PR"* ]]; then
        if gh pr update-branch "$candidate" >/dev/null 2>&1; then
          log "PR #$candidate: merged current production into the branch; CI will rerun"
        else
          log "PR #$candidate: could not merge production automatically (conflict?); waiting for its owner"
        fi
      fi
      rm "$INFLIGHT"
      continue
    fi

    # If production did not move and the PR is still open, ship.sh stopped before
    # merging and no release was attempted. That is safe to retry and must not
    # start the cooldown, whether ship.sh named a reason or GitHub just failed.
    if (( rc != 0 )) && [[ -n "$before" ]]; then
      after=$(git ls-remote origin refs/heads/production 2>/dev/null | cut -f1) || after=""
      pre_state=$(gh pr view "$candidate" --json state --jq .state 2>/dev/null) || pre_state="UNKNOWN"
      if [[ "$after" == "$before" && "$pre_state" == "OPEN" ]]; then
        if [[ -z "$reason" ]]; then
          log "PR #$candidate stopped before merging without a reason; will retry"
          rm "$INFLIGHT"
          continue
        fi
        log "PR #$candidate refused before merging: $reason"
        gh_retry pr edit "$candidate" --remove-label "$LABEL" >/dev/null || { log "PR #$candidate label removal failed; reconcile $INFLIGHT"; exit 1; }
        gh_retry pr edit "$candidate" --add-label "ship-failed" >/dev/null || { log "PR #$candidate failure label failed; reconcile $INFLIGHT"; exit 1; }
        gh pr comment "$candidate" --body "Auto-ship stopped and removed the ready-to-ship label. $reason Nothing was merged or deployed. Fix the cause and add the label again. Log: auto-ship.log on Mission Control." >/dev/null \
          || log "PR #$candidate failure comment failed"
        rm "$INFLIGHT"
        continue
      fi
    fi

    # One terminal attempt per tick, including failures. There is no pause
    # between releases: the in-flight marker, not a timer, prevents a replay if
    # label bookkeeping fails.
    gh_retry pr edit "$candidate" --remove-label "$LABEL" >/dev/null || { log "PR #$candidate label removal failed; reconcile $INFLIGHT"; exit 1; }
    if (( rc == 0 )); then
      log "PR #$candidate shipped"
      gh pr comment "$candidate" --body "Auto-ship: merged and deployed. The controller's health check passed. $(git rev-parse --short origin/production)" >/dev/null \
        || log "PR #$candidate success comment failed"
    else
      merged=$(gh pr view "$candidate" --json state --jq .state) || merged="UNKNOWN"
      log "PR #$candidate failed (status $rc, state $merged): ${reason:-see log}"
      gh_retry pr edit "$candidate" --add-label "ship-failed" >/dev/null || { log "PR #$candidate failure label failed; reconcile $INFLIGHT"; exit 1; }
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
