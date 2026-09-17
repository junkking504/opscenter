#!/bin/zsh
set -euo pipefail
[[ "$HOME" == /Users/missioncontrol ]] || exit 64
app="$HOME/opscenter-v2/opscenter"
label=com.openclaw.opscenter.address-verification
source_plist="$app/deploy/macmini/production-launchd/$label.plist"
installed="$HOME/Library/LaunchAgents/$label.plist"
plutil -lint "$source_plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/OpsCenter"
if [[ ! -f "$installed" ]] || ! cmp -s "$source_plist" "$installed"; then
  cp "$source_plist" "$installed"
  chmod 600 "$installed"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
fi
if ! launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  launchctl bootstrap "gui/$(id -u)" "$installed"
fi
launchctl enable "gui/$(id -u)/$label"
launchctl kickstart "gui/$(id -u)/$label"
echo 'Address verification agent installed: independent one-minute schedule.'
