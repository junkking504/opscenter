#!/bin/bash

# Shared, reboot-safe lock for the LinxUp poll and push processors.
# Callers must set LINXUP_LOCK_DIR before sourcing this file.

LINXUP_LOCK_ACTIVE=75
LINXUP_LOCK_ERROR=70
LINXUP_LOCK_OWNER_FILE_NAME="owner"
LINXUP_LOCK_MAX_AGE_SECONDS="${LINXUP_LOCK_MAX_AGE_SECONDS:-900}"
LINXUP_LOCK_INITIALIZING_SECONDS="${LINXUP_LOCK_INITIALIZING_SECONDS:-5}"
LINXUP_LOCK_OWNER_KIND="${LINXUP_LOCK_OWNER_KIND:-linxup}"
LINXUP_LOCK_TOKEN=""

linxup_lock_log() {
  printf '%s\n' "$*" >&2
}

linxup_lock_mtime_epoch() {
  local target="$1"
  stat -f %m "$target" 2>/dev/null || stat -c %Y "$target" 2>/dev/null
}

linxup_lock_metadata_value() {
  local owner_file="$1"
  local key="$2"
  sed -n "s/^${key}=//p" "$owner_file" 2>/dev/null | head -n 1
}

linxup_lock_valid_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

linxup_lock_write_owner() {
  local owner_file="$LINXUP_LOCK_DIR/$LINXUP_LOCK_OWNER_FILE_NAME"
  local temporary_owner="$LINXUP_LOCK_DIR/.owner.$$"
  local started_epoch="$1"

  LINXUP_LOCK_TOKEN="$$-${started_epoch}-${RANDOM:-0}"
  umask 077
  {
    printf 'pid=%s\n' "$$"
    printf 'started_epoch=%s\n' "$started_epoch"
    printf 'started_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'owner_kind=%s\n' "$LINXUP_LOCK_OWNER_KIND"
    printf 'owner_token=%s\n' "$LINXUP_LOCK_TOKEN"
  } > "$temporary_owner"
  mv "$temporary_owner" "$owner_file"
}

linxup_lock_discard_quarantine() {
  local quarantine="$1"

  rm -f "$quarantine/$LINXUP_LOCK_OWNER_FILE_NAME" "$quarantine"/.owner.* 2>/dev/null || true
  if ! rmdir "$quarantine" 2>/dev/null; then
    linxup_lock_log "LinxUp abandoned-lock quarantine retained for inspection: $quarantine"
  fi
}

linxup_lock_acquire() {
  local attempt=1
  local owner_file owner_pid started_epoch lock_mtime now_epoch lock_age owner_alive stale_reason quarantine

  [[ -n "${LINXUP_LOCK_DIR:-}" ]] || {
    linxup_lock_log "LINXUP_LOCK_DIR is required."
    return "$LINXUP_LOCK_ERROR"
  }
  linxup_lock_valid_positive_integer "$LINXUP_LOCK_MAX_AGE_SECONDS" || {
    linxup_lock_log "Invalid LinxUp lock max age: $LINXUP_LOCK_MAX_AGE_SECONDS"
    return 64
  }
  linxup_lock_valid_positive_integer "$LINXUP_LOCK_INITIALIZING_SECONDS" || {
    linxup_lock_log "Invalid LinxUp lock initialization grace: $LINXUP_LOCK_INITIALIZING_SECONDS"
    return 64
  }

  while (( attempt <= 4 )); do
    now_epoch=$(date +%s)
    if mkdir "$LINXUP_LOCK_DIR" 2>/dev/null; then
      if ! linxup_lock_write_owner "$now_epoch"; then
        rmdir "$LINXUP_LOCK_DIR" 2>/dev/null || true
        linxup_lock_log "Could not write LinxUp lock ownership metadata."
        return "$LINXUP_LOCK_ERROR"
      fi
      return 0
    fi

    [[ -d "$LINXUP_LOCK_DIR" ]] || {
      linxup_lock_log "LinxUp lock path exists but is not a directory: $LINXUP_LOCK_DIR"
      return "$LINXUP_LOCK_ERROR"
    }

    owner_file="$LINXUP_LOCK_DIR/$LINXUP_LOCK_OWNER_FILE_NAME"
    owner_pid=$(linxup_lock_metadata_value "$owner_file" pid)
    started_epoch=$(linxup_lock_metadata_value "$owner_file" started_epoch)
    lock_mtime=$(linxup_lock_mtime_epoch "$LINXUP_LOCK_DIR" || true)
    now_epoch=$(date +%s)
    if ! linxup_lock_valid_positive_integer "$started_epoch"; then
      started_epoch="$lock_mtime"
    fi
    if ! linxup_lock_valid_positive_integer "$started_epoch"; then
      started_epoch=0
    fi
    lock_age=$((now_epoch - started_epoch))
    (( lock_age < 0 )) && lock_age=0

    owner_alive=false
    if linxup_lock_valid_positive_integer "$owner_pid" && kill -0 "$owner_pid" 2>/dev/null; then
      owner_alive=true
    fi

    if [[ -f "$owner_file" && "$owner_alive" == true && "$lock_age" -le "$LINXUP_LOCK_MAX_AGE_SECONDS" ]]; then
      linxup_lock_log "LinxUp processor already active (PID $owner_pid, lock age ${lock_age}s)."
      return "$LINXUP_LOCK_ACTIVE"
    fi
    if [[ ! -f "$owner_file" && "$lock_age" -le "$LINXUP_LOCK_INITIALIZING_SECONDS" ]]; then
      linxup_lock_log "LinxUp processor lock is still initializing (age ${lock_age}s)."
      return "$LINXUP_LOCK_ACTIVE"
    fi

    if [[ "$lock_age" -gt "$LINXUP_LOCK_MAX_AGE_SECONDS" ]]; then
      stale_reason="lock age ${lock_age}s exceeds ${LINXUP_LOCK_MAX_AGE_SECONDS}s"
    elif [[ -f "$owner_file" ]]; then
      stale_reason="owner PID ${owner_pid:-unknown} is not running"
    else
      stale_reason="ownership metadata is missing"
    fi

    quarantine="${LINXUP_LOCK_DIR}.abandoned.${now_epoch}.$$.$attempt"
    if mv "$LINXUP_LOCK_DIR" "$quarantine" 2>/dev/null; then
      linxup_lock_log "Recovered abandoned LinxUp lock ($stale_reason)."
      linxup_lock_discard_quarantine "$quarantine"
      attempt=$((attempt + 1))
      continue
    fi

    attempt=$((attempt + 1))
  done

  linxup_lock_log "Could not acquire or recover the LinxUp processor lock."
  return "$LINXUP_LOCK_ERROR"
}

linxup_lock_release() {
  local owner_file current_token

  [[ -n "${LINXUP_LOCK_TOKEN:-}" && -d "${LINXUP_LOCK_DIR:-}" ]] || return 0
  owner_file="$LINXUP_LOCK_DIR/$LINXUP_LOCK_OWNER_FILE_NAME"
  current_token=$(linxup_lock_metadata_value "$owner_file" owner_token)
  if [[ "$current_token" != "$LINXUP_LOCK_TOKEN" ]]; then
    linxup_lock_log "LinxUp lock ownership changed; this process will not remove the replacement lock."
    return 0
  fi

  rm -f "$owner_file"
  rmdir "$LINXUP_LOCK_DIR" 2>/dev/null || {
    linxup_lock_log "LinxUp lock directory could not be removed cleanly: $LINXUP_LOCK_DIR"
    return "$LINXUP_LOCK_ERROR"
  }
  LINXUP_LOCK_TOKEN=""
}
