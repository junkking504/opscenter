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
[[ -f "$SOURCE_PLIST"
  && -x "$APP_DIR/scripts/run-junkware-schedule-detector.sh"
  && -f "$APP_DIR/scripts/collect-junkware-schedule-stream.py" ]] || {
  echo "JunkWare schedule detector files are missing from the active release." >&2
  exit 1
}

mkdir -p "$EXPECTED_HOME/.openclaw/workspace/opsbot/logs"
mkdir -p "$EXPECTED_HOME/.openclaw/workspace/opsbot/data/slack/junkware_schedule_watchers"
cp "$SOURCE_PLIST" "$INSTALLED_PLIST"
chmod 600 "$INSTALLED_PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PLIST"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null

HEALTH_FILE="$EXPECTED_HOME/.openclaw/workspace/opsbot/data/slack/junkware_schedule_watchers/detector.json"
for attempt in {1..18}; do
  if [ -s "$HEALTH_FILE" ]; then
    completed_at="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("completed_at", ""))' "$HEALTH_FILE" 2>/dev/null || true)"
    if [ -n "$completed_at" ] && /usr/bin/python3 -c '
from datetime import datetime
import sys
stamp = datetime.fromisoformat(sys.argv[1])
raise SystemExit(0 if (datetime.now(stamp.tzinfo) - stamp).total_seconds() <= 90 else 1)
' "$completed_at"; then
      break
    fi
  fi
  [ "$attempt" -lt 18 ] || {
    echo "JunkWare schedule detector did not produce a fresh verified heartbeat." >&2
    exit 1
  }
  sleep 5
done

# The all-market detector replaced these release-pinned watchers. Leaving them
# loaded after their source release is pruned creates a constant failed state
# and can mask a real detector failure.
for LEGACY_LABEL in \
  com.openclaw.opsbot.junkware-schedule-watcher-352 \
  com.openclaw.opsbot.junkware-schedule-watcher-399 \
  com.openclaw.opsbot.junkware-schedule-watcher-477 \
  com.openclaw.opsbot.junkware-schedule-watcher-484; do
  launchctl bootout "gui/$(id -u)/$LEGACY_LABEL" >/dev/null 2>&1 || true
  rm -f "$EXPECTED_HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"
done
