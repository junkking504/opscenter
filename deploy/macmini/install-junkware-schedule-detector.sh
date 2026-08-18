#!/bin/bash
set -Eeuo pipefail

EXPECTED_HOME="/Users/missioncontrol"
APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
LABEL="com.openclaw.opsbot.junkware-schedule-detector"
SOURCE_PLIST="$APP_DIR/deploy/macmini/production-launchd/$LABEL.plist"
INSTALLED_PLIST="$EXPECTED_HOME/Library/LaunchAgents/$LABEL.plist"
USER_ID="$(id -u)"
HEALTH_FILE="$EXPECTED_HOME/.openclaw/workspace/opsbot/data/slack/junkware_schedule_watchers/detector.json"

[[ "$(id -un)" == "missioncontrol" && "$HOME" == "$EXPECTED_HOME" ]] || {
  echo "Run this while logged in as missioncontrol." >&2
  exit 1
}
[[ -f "$SOURCE_PLIST" && -x "$APP_DIR/scripts/run-junkware-schedule-detector.sh" ]] || {
  echo "JunkWare schedule detector files are missing from the active release." >&2
  exit 1
}

mkdir -p "$(dirname "$INSTALLED_PLIST")" "$(dirname "$HEALTH_FILE")"
cp "$SOURCE_PLIST" "$INSTALLED_PLIST"
chmod 600 "$INSTALLED_PLIST"
plutil -lint "$INSTALLED_PLIST" >/dev/null
rm -f "$HEALTH_FILE"
launchctl bootout "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$USER_ID" "$INSTALLED_PLIST"
launchctl enable "gui/$USER_ID/$LABEL"

for attempt in {1..18}; do
  launchctl print "gui/$USER_ID/$LABEL" >/dev/null && \
    jq -e '.status == "ok"' "$HEALTH_FILE" >/dev/null 2>&1 && exit 0
  sleep 10
done

echo "JunkWare schedule detector did not establish a healthy heartbeat." >&2
exit 1
