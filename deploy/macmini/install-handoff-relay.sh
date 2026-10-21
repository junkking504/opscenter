#!/bin/zsh
set -euo pipefail
[[ "$HOME" == /Users/missioncontrol ]] || { echo 'Run as missioncontrol.' >&2; exit 64; }
# Installs from the active production release so the job runs a reviewed copy.
# The job stays idle until vault/Tasks/.relay-on exists; this script never creates it.
APP_DIR="$HOME/opscenter-v2/opscenter"
LABEL=com.opscenter.handoff-relay
SOURCE="$APP_DIR/deploy/macmini/production-launchd/$LABEL.plist"
SCRIPT="$APP_DIR/deploy/macmini/handoff-relay.py"
CONTROL_DIR="$HOME/Library/Application Support/OpsCenter/vault-control"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
[[ -f "$SOURCE" && -f "$SCRIPT" && -d "$HOME/opscenter-v2/vault/Tasks" ]] || exit 66
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/OpsCenter" "$CONTROL_DIR"
install -m 700 "$SCRIPT" "$CONTROL_DIR/handoff-relay.py"
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
echo 'Handoff relay installed and idle. Turn it on with: touch ~/opscenter-v2/vault/Tasks/.relay-on'
