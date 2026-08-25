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
INSTALL_STARTED_EPOCH="$(date +%s)"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
LOCK_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/tmp/junkware_schedule_detector.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"
LOCK_PID=""
[ ! -f "$LOCK_PID_FILE" ] || LOCK_PID="$(tr -dc '0-9' < "$LOCK_PID_FILE" || true)"
if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
  LOCK_COMMAND="$(ps -p "$LOCK_PID" -o command= 2>/dev/null || true)"
  if [[ "$LOCK_COMMAND" != *"run-junkware-schedule-detector.sh"* ]]; then
    echo "JunkWare detector lock belongs to an unexpected active process; refusing to terminate it." >&2
    exit 1
  fi
  LOCK_CHILD_PIDS="$(pgrep -P "$LOCK_PID" || true)"
  for child_pid in $LOCK_CHILD_PIDS; do
    child_command="$(ps -p "$child_pid" -o command= 2>/dev/null || true)"
    if [[ "$child_command" != *"collect-junkware-schedule-stream.py"* ]]; then
      echo "JunkWare detector has an unexpected child process; refusing to terminate it." >&2
      exit 1
    fi
  done
  # A validated detector may finish its current sweep after the checks above.
  # Treat an already-exited process as a successful stop, not an install error.
  [ -z "$LOCK_CHILD_PIDS" ] || kill -TERM $LOCK_CHILD_PIDS 2>/dev/null || true
  kill -TERM "$LOCK_PID" 2>/dev/null || true
  for attempt in {1..10}; do
    detector_active=false
    kill -0 "$LOCK_PID" 2>/dev/null && detector_active=true
    for child_pid in $LOCK_CHILD_PIDS; do
      kill -0 "$child_pid" 2>/dev/null && detector_active=true
    done
    [ "$detector_active" = false ] && break
    sleep 1
  done
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Orphaned JunkWare detector did not stop after SIGTERM." >&2
    exit 1
  fi
  for child_pid in $LOCK_CHILD_PIDS; do
    if kill -0 "$child_pid" 2>/dev/null; then
      echo "Orphaned JunkWare detector child did not stop after SIGTERM." >&2
      exit 1
    fi
  done
fi
if [ -d "$LOCK_DIR" ]; then
  rm -f "$LOCK_PID_FILE"
  rmdir "$LOCK_DIR" 2>/dev/null || {
    echo "JunkWare detector lock directory could not be recovered." >&2
    exit 1
  }
fi
for attempt in {1..5}; do
  if launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PLIST"; then
    break
  fi
  [ "$attempt" -lt 5 ] || {
    echo "JunkWare schedule detector could not be bootstrapped after five attempts." >&2
    exit 1
  }
  # launchd can briefly retain the prior persistent process after bootout.
  sleep 2
done
launchctl enable "gui/$(id -u)/$LABEL"
launchctl print "gui/$(id -u)/$LABEL" >/dev/null

HEALTH_FILE="$EXPECTED_HOME/.openclaw/workspace/opsbot/data/slack/junkware_schedule_watchers/detector.json"
for attempt in {1..18}; do
  if [ -s "$HEALTH_FILE" ]; then
    completed_at="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("completed_at", ""))' "$HEALTH_FILE" 2>/dev/null || true)"
    if [ -n "$completed_at" ] && /usr/bin/python3 -c '
from datetime import datetime
import sys
stamp = datetime.fromisoformat(sys.argv[1])
raise SystemExit(0 if stamp.timestamp() >= int(sys.argv[2]) else 1)
' "$completed_at" "$INSTALL_STARTED_EPOCH"; then
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
