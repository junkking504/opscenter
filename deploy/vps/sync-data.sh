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
  # Atomic writes from the container can replace a shared file with a private
  # mode. Normalize the bounded shared-state paths before the host pulls them.
  ssh "${SSH_ARGS[@]}" "$REMOTE" "docker run --rm --user 0 \
    -v '$REMOTE_DATA_DIR:/data' \
    --entrypoint /bin/sh node:22-bookworm-slim \
    -c 'state_dirs=\"/data/manual_bonuses /data/job-route-assignments /data/job-route-geocodes /data/searchkings-overrides /data/fleet /data/finance /data/job-call-ahead /data/integrations/junkware-sms /data/integrations/whatsapp-job-photos /data/integrations/whatsapp-crew-expenses\" && mkdir -p \$state_dirs && chown -R 1001:1000 \$state_dirs && find \$state_dirs -type d -exec chmod 2770 {} \; && find \$state_dirs -type f -exec chmod 0660 {} \;'"

  # These folders are written by the VPS app. Pull them back first so the Mac
  # collector sees manual changes before it produces the next metrics file.
  rsync -az -e "$RSYNC_RSH" --delay-updates \
    --include '/manual_bonuses/***' \
    --include '/job-route-assignments/***' \
    --include '/job-route-geocodes/***' \
    --include '/searchkings-overrides/***' \
    --include '/fleet/***' \
    --include '/finance/***' \
    --include '/job-call-ahead/***' \
    --include '/integrations/' \
    --include '/integrations/junkware-sms/***' \
    --include '/integrations/whatsapp-job-photos/***' \
    --include '/integrations/whatsapp-crew-expenses/***' \
    --exclude '*' \
    "$REMOTE:$REMOTE_DATA_DIR/" "$LOCAL_DATA_DIR/"
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
  --exclude '/fleet/' \
  --exclude '/finance/' \
  --exclude '/job-call-ahead/' \
  --exclude '/integrations/' \
  "$LOCAL_DATA_DIR/" "$REMOTE:$REMOTE_DATA_DIR/"

if [[ "$MODE" == "initial" ]]; then
  rsync -az -e "$RSYNC_RSH" --delay-updates \
    --include '/manual_bonuses/***' \
    --include '/job-route-assignments/***' \
    --include '/job-route-geocodes/***' \
    --include '/searchkings-overrides/***' \
    --include '/fleet/***' \
    --include '/finance/***' \
    --include '/job-call-ahead/***' \
    --include '/integrations/' \
    --include '/integrations/junkware-sms/***' \
    --include '/integrations/whatsapp-job-photos/***' \
    --include '/integrations/whatsapp-crew-expenses/***' \
    --exclude '*' \
    "$LOCAL_DATA_DIR/" "$REMOTE:$REMOTE_DATA_DIR/"
fi

echo "OpsCenter data sync completed: $MODE"
