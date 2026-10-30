#!/bin/zsh
# Zero-touch release: ships the oldest open PR labeled `ready-to-ship`.
# Run on a timer (see launchd/com.opscenter.auto-ship.plist.example). Every
# release still goes through ship.sh (CI, conflicts, claude-stop label, review
# gate) and the installed controller (build, health check, automatic rollback).
# Off switch: touch "$CONFIG_DIR/auto-ship.off". At most one release per hour.
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

# Parsed as one function so refreshing the worktree cannot change the running script.
main() {
  mkdir -p "$CONFIG_DIR"
  log() { printf "%s\n" "$(date -u +%FT%TZ) $*" >> "$LOG"; }

  [[ -e "$CONFIG_DIR/auto-ship.off" ]] && exit 0
  [[ -e "$DEPLOY_LOCK" ]] && exit 0
  # Skip when a release finished within the last MIN_INTERVAL seconds.
  if [[ -f "$STAMP" && -n "$(find "$STAMP" -mmin "-$(( MIN_INTERVAL / 60 ))" 2>/dev/null)" ]]; then
    exit 0
  fi
  mkdir "$LOCK" 2>/dev/null || exit 0
  trap 'rmdir "$LOCK"' EXIT

  # launchd starts in /, and gh needs a repository, so enter the ship checkout first.
  cd "$SHIP_WORKTREE" || { log "cannot enter $SHIP_WORKTREE"; exit 1; }
  prs=$(gh pr list --base production --state open --label "$LABEL" --json number,createdAt \
    --jq 'sort_by(.createdAt) | .[].number') || { log "queue lookup failed"; exit 1; }
  [[ -n "$prs" ]] || exit 0

  git fetch origin production
  git checkout --detach origin/production

  # Oldest first, but a PR that is not ready yet (CI pending, conflicts) must not
  # block the ones behind it. `status` is read-only in zsh, so use `rc`.
  pr=""
  for candidate in ${(f)prs}; do
    log "shipping PR #$candidate"
    set +e
    output=$(deploy/macmini/ship.sh "$candidate" 2>&1)
    rc=$?
    set -e
    printf "%s\n" "$output" | tail -40 >> "$LOG"
    reason=$(printf "%s\n" "$output" | grep -E '^ship stopped:' | tail -1 || true)
    # CI still running is not a failure: keep the label and try again next tick.
    if (( rc != 0 )) && [[ "$reason" == *"checks pending or failing"* || "$reason" == *"not mergeable yet"* ]]; then
      log "PR #$candidate not ready yet: $reason"
      continue
    fi
    pr=$candidate
    break
  done
  [[ -n "$pr" ]] || exit 0

  touch "$STAMP"
  gh pr edit "$pr" --remove-label "$LABEL" >/dev/null || true
  if (( rc == 0 )); then
    log "PR #$pr shipped"
    gh pr comment "$pr" --body "Auto-ship: merged and deployed. The controller's health check passed. $(git rev-parse --short origin/production)" >/dev/null || true
  else
    merged=$(gh pr view "$pr" --json state --jq .state)
    log "PR #$pr failed (status $rc, state $merged): ${reason:-see log}"
    gh pr edit "$pr" --add-label "ship-failed" >/dev/null || true
    gh pr comment "$pr" --body "Auto-ship stopped and removed the ready-to-ship label. ${reason:-Deployment did not finish.} PR state: $merged. Production was not changed unless this PR is merged; the controller restores the previous release if its health check fails. Log: auto-ship.log on Mission Control." >/dev/null || true
  fi
}
main "$@"
