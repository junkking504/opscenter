#!/bin/bash
set -Eeuo pipefail

EXPECTED_HOME="/Users/missioncontrol"
APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
LABEL="com.openclaw.opsbot.junkware-schedule-detector"
SOURCE_PLIST="$APP_DIR/deploy/macmini/production-launchd/$LABEL.plist"
INSTALLED_PLIST="$EXPECTED_HOME/Library/LaunchAgents/$LABEL.plist"

[[ "$(id -un)" == "missioncontrol" && "$HOME" == "$EXPECTED_HOME" ]] || {
  echo "Run this while logged in as missioncontrol." >&2
  exit 1
}
[[ -f "$SOURCE_PLIST" && -x "$APP_DIR/scripts/run-junkware-schedule-detector.sh" ]] || {
  echo "JunkWare schedule detector files are missing from the active release." >&2
  exit 1
}

mkdir -p "$EXPECTED_HOME/.openclaw/workspace/opsbot/logs"
cp "$SOURCE_PLIST" "$INSTALLED_PLIST"
chmod 600 "$INSTALLED_PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null
