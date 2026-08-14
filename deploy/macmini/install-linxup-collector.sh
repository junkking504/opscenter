#!/bin/zsh
set -euo pipefail

EXPECTED_HOME="/Users/missioncontrol"
[[ "${HOME:?HOME must be set}" == "$EXPECTED_HOME" ]] || {
  echo "Run this installer as missioncontrol." >&2
  exit 64
}

APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
SOURCE_PLIST="$APP_DIR/deploy/macmini/production-launchd/com.openclaw.opsbot.linxup-collector.plist"
INSTALLED_PLIST="$EXPECTED_HOME/Library/LaunchAgents/com.openclaw.opsbot.linxup-collector.plist"
LABEL="com.openclaw.opsbot.linxup-collector"
LOG_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/logs"

[[ -f "$SOURCE_PLIST" && -x "$APP_DIR/scripts/run-linxup-live-refresh.sh" ]] || {
  echo "LinxUp collector release files are unavailable." >&2
  exit 66
}

/usr/bin/security find-generic-password -s opsbot-linxup-api-token-v2 >/dev/null 2>&1 || {
  echo "Missing required LinxUp Keychain item." >&2
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
echo "LinxUp collector installed; live GPS and visit matching refresh every minute."
