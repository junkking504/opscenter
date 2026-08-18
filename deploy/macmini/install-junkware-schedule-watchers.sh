#!/bin/bash
set -Eeuo pipefail

EXPECTED_HOME="/Users/missioncontrol"
APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
LEGACY_LABEL="com.openclaw.opsbot.junkware-schedule-detector"
LABEL_PREFIX="com.openclaw.opsbot.junkware-schedule-watcher"
SOURCE_PLIST="$APP_DIR/deploy/macmini/production-launchd/com.openclaw.opsbot.junkware-schedule-market-watcher.plist"
LAUNCH_AGENTS_DIR="$EXPECTED_HOME/Library/LaunchAgents"
USER_ID="$(id -u)"

[[ "$(id -un)" == "missioncontrol" && "$HOME" == "$EXPECTED_HOME" ]] || {
  echo "Run this while logged in as missioncontrol." >&2
  exit 1
}
[[ -f "$SOURCE_PLIST" && -x "$APP_DIR/scripts/run-junkware-schedule-market-watcher.sh" && -x "$APP_DIR/scripts/collect-junkware-schedule-market.py" ]] || {
  echo "JunkWare schedule watcher files are missing from the active release." >&2
  exit 1
}
for command in jq launchctl plutil; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command is missing: $command" >&2
    exit 1
  }
done

mkdir -p "$LAUNCH_AGENTS_DIR" "$EXPECTED_HOME/.openclaw/workspace/opsbot/logs"
HEALTH_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/data/slack/junkware_schedule_watchers"
mkdir -p "$HEALTH_DIR"

for MARKET_ID in 352 477 399 484; do
  LABEL="$LABEL_PREFIX-$MARKET_ID"
  INSTALLED_PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
  rm -f "$HEALTH_DIR/$MARKET_ID.json"
  sed -e "s/__LABEL__/$LABEL/g" -e "s/__MARKET_ID__/$MARKET_ID/g" "$SOURCE_PLIST" > "$INSTALLED_PLIST"
  chmod 600 "$INSTALLED_PLIST"
  plutil -lint "$INSTALLED_PLIST" >/dev/null
  launchctl bootout "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$USER_ID" "$INSTALLED_PLIST"
  launchctl enable "gui/$USER_ID/$LABEL"
done

for attempt in {1..12}; do
  healthy=true
  for MARKET_ID in 352 477 399 484; do
    launchctl print "gui/$USER_ID/$LABEL_PREFIX-$MARKET_ID" >/dev/null || healthy=false
    jq -e '.status == "ok"' "$HEALTH_DIR/$MARKET_ID.json" >/dev/null 2>&1 || healthy=false
  done
  if $healthy; then
    # Retire the aggregate detector only after every scoped worker has
    # successfully completed a verified baseline sweep.
    launchctl bootout "gui/$USER_ID/$LEGACY_LABEL" >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 10
done

for MARKET_ID in 352 477 399 484; do
  launchctl bootout "gui/$USER_ID/$LABEL_PREFIX-$MARKET_ID" >/dev/null 2>&1 || true
done
echo "JunkWare schedule watchers did not establish all four healthy heartbeats; legacy detector was left running." >&2
exit 1
