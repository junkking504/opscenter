#!/usr/bin/env bash
set -euo pipefail

REMOTE="${OPSCENTER_VPS:-}"
REMOTE_ROOT="${OPSCENTER_REMOTE_ROOT:-/srv/opscenter}"
SSH_KEY="${OPSCENTER_SSH_KEY:-}"
SSH_ARGS=()
RSYNC_RSH="ssh"
LOCAL_DATA_INPUT="${OPSBOT_DATA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)/data}"
MODE="${1:-incremental}"

if [[ -z "$REMOTE" ]]; then
  echo "Set OPSCENTER_VPS to the SSH destination, for example deploy@203.0.113.10." >&2
  exit 64
fi

if [[ -z "$REMOTE_ROOT" || "$REMOTE_ROOT" == "/" ]]; then
  echo "Refusing unsafe remote root: $REMOTE_ROOT" >&2
  exit 64
fi

if [[ -n "$SSH_KEY" ]]; then
  if [[ ! -f "$SSH_KEY" ]]; then
    echo "SSH key does not exist: $SSH_KEY" >&2
    exit 66
  fi
  SSH_ARGS=(-i "$SSH_KEY")
  printf -v RSYNC_RSH 'ssh -i %q' "$SSH_KEY"
fi

if [[ ! -d "$LOCAL_DATA_INPUT" ]]; then
  echo "Local OpsBot data directory does not exist: $LOCAL_DATA_INPUT" >&2
  exit 66
fi

LOCAL_DATA_DIR="$(cd "$LOCAL_DATA_INPUT" && pwd -P)"
REMOTE_DATA_DIR="$REMOTE_ROOT/data"

ssh "${SSH_ARGS[@]}" "$REMOTE" "test -d '$REMOTE_DATA_DIR'"

if [[ "$MODE" == "incremental" ]]; then
  # These folders are written by the VPS app. Pull them back first so the Mac
  # collector sees manual changes before it produces the next metrics file.
  for state_dir in manual_bonuses job-route-assignments job-route-geocodes searchkings-overrides; do
    if ssh "${SSH_ARGS[@]}" "$REMOTE" "test -d '$REMOTE_DATA_DIR/$state_dir'"; then
      mkdir -p "$LOCAL_DATA_DIR/$state_dir"
      rsync -az -e "$RSYNC_RSH" --delay-updates \
        "$REMOTE:$REMOTE_DATA_DIR/$state_dir/" \
        "$LOCAL_DATA_DIR/$state_dir/"
    fi
  done
elif [[ "$MODE" != "initial" ]]; then
  echo "Usage: $0 [initial|incremental]" >&2
  exit 64
fi

rsync -az -e "$RSYNC_RSH" --delay-updates \
  --exclude '/backups/' \
  --exclude '/audits/' \
  --exclude '/diagnostics/' \
  --exclude '/logs/' \
  --exclude '/quarantine/' \
  --exclude '/raw/' \
  --exclude '/repairs/' \
  --exclude '/reports/' \
  --exclude '/manual_bonuses/' \
  --exclude '/job-route-assignments/' \
  --exclude '/job-route-geocodes/' \
  --exclude '/searchkings-overrides/' \
  "$LOCAL_DATA_DIR/" "$REMOTE:$REMOTE_DATA_DIR/"

if [[ "$MODE" == "initial" ]]; then
  for state_dir in manual_bonuses job-route-assignments job-route-geocodes searchkings-overrides; do
    if [[ -d "$LOCAL_DATA_DIR/$state_dir" ]]; then
      rsync -az -e "$RSYNC_RSH" --delay-updates \
        "$LOCAL_DATA_DIR/$state_dir/" \
        "$REMOTE:$REMOTE_DATA_DIR/$state_dir/"
    fi
  done
fi

echo "OpsCenter data sync completed: $MODE"
