#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
[[ "$(id -un)" == missioncontrol && "$HOME" == /Users/missioncontrol ]] || exit 77
CONTROL_DIR="/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control"
STATE_DIR="/Users/missioncontrol/opscenter-v2/.release-slots"
SLOT_ID="${1:?slot a or b required}"
slot_lines=("${(@f)$(node "$CONTROL_DIR/origin-state.mjs" slot "$STATE_DIR" "$SLOT_ID")}")
[[ ${#slot_lines[@]} == 2 ]] || exit 65
PINNED_RELEASE="$slot_lines[1]"
PINNED_PORT="$slot_lines[2]"
set -a
source "/Users/missioncontrol/Library/Application Support/OpsCenter/production.env"
set +a
source "$PINNED_RELEASE/scripts/load-opscenter-secrets.sh"
export OPSBOT_DATA_DIR="/Users/missioncontrol/.openclaw/workspace/opsbot/data"
exec /usr/bin/python3 "$CONTROL_DIR/slot-process.py" "$SLOT_ID" "$PINNED_RELEASE" "$PINNED_PORT"
