#!/bin/zsh
set -euo pipefail

EXPECTED_HOME="/Users/missioncontrol"
[[ "${HOME:?HOME must be set}" == "$EXPECTED_HOME" ]] || {
  echo "Run this installer as missioncontrol." >&2
  exit 64
}

APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
SOURCE_PLIST="$APP_DIR/deploy/macmini/production-launchd/com.openclaw.opsbot.podium-reviews-collector.plist"
INSTALLED_PLIST="$EXPECTED_HOME/Library/LaunchAgents/com.openclaw.opsbot.podium-reviews-collector.plist"
LABEL="com.openclaw.opsbot.podium-reviews-collector"
LOG_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/logs"
TOKEN_FILE="$EXPECTED_HOME/Library/Application Support/OpsCenter/podium/tokens.json"

[[ -f "$SOURCE_PLIST" && -x "$APP_DIR/scripts/run-podium-reviews-refresh.sh" ]] || {
  echo "Podium reviews collector release files are unavailable." >&2
  exit 66
}

for service in \
  com.opscenter.podium-client-id \
  com.opscenter.podium-client-secret \
  com.opscenter.podium-token-encryption-key
do
  /usr/bin/security find-generic-password -a opscenter -s "$service" >/dev/null 2>&1 || {
    echo "Missing required Podium Keychain item: $service" >&2
    exit 78
  }
done
[[ -f "$TOKEN_FILE" ]] || {
  echo "Podium OAuth must be completed before installing the reviews collector." >&2
  exit 78
}

mkdir -p "$EXPECTED_HOME/Library/LaunchAgents" "$LOG_DIR"
plutil -lint "$SOURCE_PLIST" >/dev/null
cp "$SOURCE_PLIST" "$INSTALLED_PLIST"
chmod 600 "$INSTALLED_PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null
echo "Podium reviews collector installed; Google reviews refresh every 15 minutes."
