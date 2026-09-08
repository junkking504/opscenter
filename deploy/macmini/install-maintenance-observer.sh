#!/bin/zsh
set -euo pipefail
[[ "$HOME" == /Users/missioncontrol ]] || { echo 'Run as missioncontrol.' >&2; exit 64; }
APP_DIR="$HOME/opscenter-v2/opscenter"
LABEL=com.openclaw.opscenter.maintenance
SOURCE="$APP_DIR/deploy/macmini/production-launchd/$LABEL.plist"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
[[ -f "$SOURCE" && -f "$APP_DIR/scripts/run-opscenter-observer.py" && -x /opt/homebrew/bin/node ]] || exit 66
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/OpsCenter"
plutil -lint "$SOURCE" >/dev/null
if [[ ! -f "$TARGET" ]] || ! cmp -s "$SOURCE" "$TARGET"; then
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  cp "$SOURCE" "$TARGET"
  chmod 600 "$TARGET"
fi
if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootstrap "gui/$(id -u)" "$TARGET"
fi
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart "gui/$(id -u)/$LABEL"
echo 'OpsBot observation pilot installed. Automatic repairs are disabled.'
