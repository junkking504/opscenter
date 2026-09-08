#!/bin/bash
# Reclaim disk on Mission Control.
#
# The data volume has thrown 389 ENOSPC errors across eight services - it has
# killed the web app, the Playwright browser the JunkWare collector depends on,
# the SearchKings collector and every schedule watcher - because nothing rotates
# logs or prunes generated artefacts. A single refresh log had grown to 320MB.
#
# Defaults to a dry run. Pass --apply to actually delete. Job photos are never
# deleted by this script: they are operational evidence, and their retention is
# a business decision rather than a maintenance one.
set -Eeuo pipefail

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

USER_HOME="${HOME:?HOME must be set}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
LOG_DIR="${OPSCENTER_LOG_DIR:-$USER_HOME/Library/Logs/OpsCenter}"

LOG_MAX_MB="${OPSCENTER_LOG_MAX_MB:-32}"
LOG_KEEP="${OPSCENTER_LOG_KEEP:-3}"
PUSH_RECEIPT_DAYS="${OPSCENTER_PUSH_RECEIPT_DAYS:-14}"
AUDIT_DAYS="${OPSCENTER_AUDIT_RETENTION_DAYS:-90}"

reclaimed=0

note() { printf '%s\n' "$*"; }

human() {
  local bytes="$1"
  awk -v b="$bytes" 'BEGIN { split("B KB MB GB TB", u, " "); i = 1; while (b >= 1024 && i < 5) { b /= 1024; i++ } printf "%.1f %s", b, u[i] }'
}

# --- 1. Rotate oversized logs -------------------------------------------------
rotate_logs() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  while IFS= read -r -d '' log; do
    local size
    size=$(stat -f%z "$log" 2>/dev/null || stat -c%s "$log" 2>/dev/null || echo 0)
    (( size > LOG_MAX_MB * 1024 * 1024 )) || continue
    note "rotate  $(human "$size")  $log"
    reclaimed=$(( reclaimed + size ))
    if (( APPLY )); then
      # Shift existing generations down before creating a new one, oldest first,
      # then drop anything past LOG_KEEP.
      rm -f "$log.$LOG_KEEP.gz"
      local generation=$(( LOG_KEEP - 1 ))
      while (( generation >= 1 )); do
        [[ -f "$log.$generation.gz" ]] && mv -f "$log.$generation.gz" "$log.$(( generation + 1 )).gz"
        generation=$(( generation - 1 ))
      done
      # Copy-truncate keeps the writing process's fd valid, so long-running
      # collectors do not need a restart.
      cp "$log" "$log.1"
      : > "$log"
      gzip -f "$log.1"
    fi
  done < <(find "$dir" -maxdepth 2 -type f -name '*.log' -print0)
}

# --- 2. Prune merged LinxUp push receipts ------------------------------------
prune_push_receipts() {
  local dir="$OPSBOT_DIR/data/history/linxup/push"
  [[ -d "$dir" ]] || return 0
  # Each day's receipts are already merged into linxup_location_<date>.json, so
  # the raw envelopes past the replay window are redundant.
  while IFS= read -r -d '' day; do
    local name size
    name=$(basename "$day")
    [[ "$name" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
    local cutoff
    cutoff=$(date -u -v-"${PUSH_RECEIPT_DAYS}"d +%Y-%m-%d 2>/dev/null \
      || date -u -d "${PUSH_RECEIPT_DAYS} days ago" +%Y-%m-%d)
    [[ "$name" < "$cutoff" ]] || continue
    if [[ ! -f "$OPSBOT_DIR/data/history/linxup/linxup_location_${name}.json" ]]; then
      note "keep    $day (no merged location file - not safe to prune)"
      continue
    fi
    size=$(du -sk "$day" 2>/dev/null | awk '{print $1 * 1024}')
    note "prune   $(human "${size:-0}")  $day"
    reclaimed=$(( reclaimed + ${size:-0} ))
    (( APPLY )) && rm -rf "$day"
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -type d -print0)
}

# --- 3. Prune superseded audit exports ---------------------------------------
prune_audits() {
  local dir="$OPSBOT_DIR/data/audits"
  [[ -d "$dir" ]] || return 0
  while IFS= read -r -d '' file; do
    local size
    size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo 0)
    note "prune   $(human "$size")  $file"
    reclaimed=$(( reclaimed + size ))
    (( APPLY )) && rm -f "$file"
  done < <(find "$dir" -maxdepth 1 -type f \( -name '*.csv' -o -name '*.json' \) -mtime +"$AUDIT_DAYS" -print0)
}

note "OpsCenter storage maintenance ($( ((APPLY)) && echo APPLY || echo 'dry run' ))"
note ""
rotate_logs "$LOG_DIR"
rotate_logs "$OPSBOT_DIR/logs"
rotate_logs "$OPSBOT_DIR/data/logs"
prune_push_receipts
prune_audits
note ""
note "Reclaimable: $(human "$reclaimed")"
(( APPLY )) || note "Nothing was deleted. Re-run with --apply to reclaim."
