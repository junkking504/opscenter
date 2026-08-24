#!/bin/bash

# The JunkWare collector uses this directory as an atomic mutual-exclusion
# lock. A process killed before its EXIT trap runs can leave it behind and
# silently prevent every later current-data refresh. Only clear an expired
# lock when no refresh runner is still executing.

opscenter_refresh_lock_log() {
  printf '%s\n' "$*"
}

opscenter_refresh_lock_mtime_epoch() {
  stat -f %m "$1" 2>/dev/null
}

recover_abandoned_opscenter_refresh_lock() {
  local lock_dir="${OPSCENTER_REFRESH_LOCK_DIR:-${OPSBOT_DIR:?OPSBOT_DIR must be set}/tmp/opscenter_refresh.lock}"
  local max_age_seconds="${OPSCENTER_REFRESH_LOCK_MAX_AGE_SECONDS:-900}"
  local now_epoch lock_mtime lock_age

  case "$max_age_seconds" in
    ''|*[!0-9]*)
      opscenter_refresh_lock_log "Invalid OpsCenter refresh lock max age: $max_age_seconds"
      return 64
      ;;
  esac

  [ -d "$lock_dir" ] || return 0

  lock_mtime="$(opscenter_refresh_lock_mtime_epoch "$lock_dir" || true)"
  case "$lock_mtime" in
    ''|*[!0-9]*)
      opscenter_refresh_lock_log "Unable to read OpsCenter refresh lock timestamp: $lock_dir"
      return 1
      ;;
  esac

  now_epoch="$(date +%s)"
  lock_age=$((now_epoch - lock_mtime))
  [ "$lock_age" -gt "$max_age_seconds" ] || return 0

  # A slow but live collector is safer than concurrent JunkWare collectors.
  if pgrep -f '[r]un_opscenter_refresh\.sh' >/dev/null 2>&1; then
    opscenter_refresh_lock_log "OpsCenter refresh lock is ${lock_age}s old, but its runner is still active."
    return 0
  fi

  if rmdir "$lock_dir" 2>/dev/null; then
    opscenter_refresh_lock_log "Recovered abandoned OpsCenter refresh lock (${lock_age}s old)."
    return 0
  fi

  opscenter_refresh_lock_log "Unable to recover abandoned OpsCenter refresh lock: $lock_dir"
  return 1
}
