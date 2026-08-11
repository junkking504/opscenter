#!/bin/zsh
set -euo pipefail

EXPECTED_HOME="/Users/missioncontrol"
[[ "${HOME:?HOME must be set}" == "$EXPECTED_HOME" ]] || {
  echo "Run this installer as missioncontrol." >&2
  exit 64
}

APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
SOURCE_PLIST="$APP_DIR/deploy/macmini/production-launchd/com.openclaw.opscenter.whatsapp-photos.plist"
INSTALLED_PLIST="$EXPECTED_HOME/Library/LaunchAgents/com.openclaw.opscenter.whatsapp-photos.plist"
LABEL="com.openclaw.opscenter.whatsapp-photos"
ENV_FILE="$EXPECTED_HOME/Library/Application Support/OpsCenter/production.env"

[[ -f "$SOURCE_PLIST" && -x "$APP_DIR/scripts/run-whatsapp-photo-worker.sh" ]] || {
  echo "WhatsApp photo worker release files are unavailable." >&2
  exit 66
}
[[ -f "$ENV_FILE" ]] || {
  echo "OpsCenter production environment file is unavailable." >&2
  exit 66
}

mkdir -p "$EXPECTED_HOME/Library/LaunchAgents" "$APP_DIR/logs"
cp "$SOURCE_PLIST" "$INSTALLED_PLIST"
chmod 600 "$INSTALLED_PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null
echo "WhatsApp photo worker installed and running."
