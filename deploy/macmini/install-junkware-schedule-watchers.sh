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

mkdir -p "$LAUNCH_AGENTS_DIR" "$EXPECTED_HOME/.openclaw/workspace/opsbot/logs"

# The legacy aggregate detector would duplicate messages with the scoped
# watchers, so retire it before bootstrapping the independent workers.
launchctl bootout "gui/$USER_ID/$LEGACY_LABEL" >/dev/null 2>&1 || true

for MARKET_ID in 352 477 399 484; do
  LABEL="$LABEL_PREFIX-$MARKET_ID"
  INSTALLED_PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
  sed -e "s/__LABEL__/$LABEL/g" -e "s/__MARKET_ID__/$MARKET_ID/g" "$SOURCE_PLIST" > "$INSTALLED_PLIST"
  chmod 600 "$INSTALLED_PLIST"
  plutil -lint "$INSTALLED_PLIST" >/dev/null
  launchctl bootout "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$USER_ID" "$INSTALLED_PLIST"
  launchctl enable "gui/$USER_ID/$LABEL"
  launchctl kickstart -k "gui/$USER_ID/$LABEL"
done

for MARKET_ID in 352 477 399 484; do
  launchctl print "gui/$USER_ID/$LABEL_PREFIX-$MARKET_ID" >/dev/null
done
