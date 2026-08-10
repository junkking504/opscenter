#!/bin/zsh
set -euo pipefail

SOURCE_HOME="/Users/ejd"
SOURCE_APP="$SOURCE_HOME/opscenter-v2/opscenter"
SOURCE_DATA="$SOURCE_HOME/.openclaw/workspace/opsbot/data"
DESTINATION_PARENT="${1:-}"

fail() {
  echo "Preview transfer creation stopped: $*" >&2
  exit 1
}

[[ -n "$DESTINATION_PARENT" ]] || fail "usage: $0 /absolute/path/to/external-drive-or-folder"
[[ "$DESTINATION_PARENT" == /* ]] || fail "destination must be an absolute path"
[[ -d "$DESTINATION_PARENT" ]] || fail "destination directory does not exist: $DESTINATION_PARENT"
[[ -d "$SOURCE_APP" ]] || fail "missing source application: $SOURCE_APP"
[[ -d "$SOURCE_DATA" ]] || fail "missing source data: $SOURCE_DATA"
command -v rsync >/dev/null 2>&1 || fail "rsync is required"

timestamp="$(date +%Y%m%d-%H%M%S)"
BUNDLE_ROOT="$DESTINATION_PARENT/OpsCenter-MacMini-Preview-$timestamp"
TARGET_APP="$BUNDLE_ROOT/Users/missioncontrol/opscenter-v2/opscenter"
TARGET_DATA="$BUNDLE_ROOT/Users/missioncontrol/.openclaw/workspace/opsbot/data"

[[ ! -e "$BUNDLE_ROOT" ]] || fail "bundle already exists: $BUNDLE_ROOT"
mkdir -p "$TARGET_APP" "$TARGET_DATA"

rsync -a \
  --exclude '/.git/' \
  --exclude '/node_modules/' \
  --exclude '/.next/' \
  --exclude '/.next-*/' \
  --exclude '/.open-next/' \
  --exclude '/tmp/' \
  --exclude '/logs/' \
  --exclude '/data' \
  --exclude '/.env' \
  --exclude '/.env.*' \
  "$SOURCE_APP/" "$TARGET_APP/"

# A second pass reduces the preview snapshot's drift while production continues
# to collect. This is intentionally a non-authoritative, read-mostly snapshot.
rsync -a "$SOURCE_DATA/" "$TARGET_DATA/"
rsync -a "$SOURCE_DATA/" "$TARGET_DATA/"

{
  echo "OpsCenter Mac Mini preview transfer"
  echo "Created: $(date)"
  echo "Source app: $SOURCE_APP"
  echo "Source data: $SOURCE_DATA"
  echo "Target account: missioncontrol"
  echo "Mode: isolated localhost preview; not production"
  echo "Production secrets, Cloudflare credentials, SSH keys, browser profiles, and LaunchAgents are intentionally excluded."
} > "$BUNDLE_ROOT/TRANSFER-MANIFEST.txt"

echo "Preview transfer created at:"
echo "$BUNDLE_ROOT"
echo
echo "The live OpsCenter services on this Mac were not stopped or changed."
