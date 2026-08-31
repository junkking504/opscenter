#!/bin/zsh
set -euo pipefail

EXPECTED_HOME="/Users/missioncontrol"
[[ "${HOME:?HOME must be set}" == "$EXPECTED_HOME" ]] || {
  echo "Run this installer as missioncontrol." >&2
  exit 64
}

APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
SOURCE_PLIST="$APP_DIR/deploy/macmini/production-launchd/com.openclaw.opsbot.searchkings-collector.plist"
INSTALLED_PLIST="$EXPECTED_HOME/Library/LaunchAgents/com.openclaw.opsbot.searchkings-collector.plist"
LABEL="com.openclaw.opsbot.searchkings-collector"
LOG_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/logs"

[[ -f "$SOURCE_PLIST" && -x "$APP_DIR/scripts/run-searchkings-refresh.sh" ]] || {
  echo "SearchKings collector release files are unavailable." >&2
  exit 66
}

for service in \
  opsbot-searchkings-username \
  opsbot-searchkings-password \
  opsbot-searchkings-firebase-api-key
do
  /usr/bin/security find-generic-password -a opscenter -s "$service" >/dev/null 2>&1 || {
    echo "Missing required SearchKings Keychain item: $service" >&2
    exit 78
  }
done

mkdir -p "$EXPECTED_HOME/Library/LaunchAgents" "$LOG_DIR"
plutil -lint "$SOURCE_PLIST" >/dev/null
if [[ ! -f "$INSTALLED_PLIST" ]] || ! cmp -s "$SOURCE_PLIST" "$INSTALLED_PLIST"; then
  cp "$SOURCE_PLIST" "$INSTALLED_PLIST"
  chmod 600 "$INSTALLED_PLIST"
fi
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null
echo "SearchKings collector installed; it checks every five minutes and refreshes snapshots at most every 15 minutes."
