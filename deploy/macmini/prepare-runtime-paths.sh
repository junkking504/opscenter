#!/bin/zsh
set -euo pipefail

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
OPSBOT_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot"

fail() {
  echo "Mission Control path preparation stopped: $*" >&2
  exit 1
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ -d "$OPSBOT_DIR" ]] || fail "missing OpsBot workspace: $OPSBOT_DIR"

files=(
  "$EXPECTED_HOME/.openclaw/openclaw.json"
  "$OPSBOT_DIR/scripts/run_opscenter_refresh.sh"
  "$OPSBOT_DIR/scripts/browser_keepalive.sh"
  "$OPSBOT_DIR/scripts/junkware_manual_reauth.sh"
  "$OPSBOT_DIR/scripts/run_junkware_collect_today.sh"
)

for file in "${files[@]}"; do
  [[ -f "$file" ]] || fail "required runtime file is missing: $file"
  if /usr/bin/grep -q '/Users/ejd' "$file"; then
    backup="$file.before-missioncontrol"
    [[ ! -e "$backup" ]] || fail "backup already exists and requires review: $backup"
    /bin/cp -p "$file" "$backup"
    /usr/bin/sed -i '' 's#/Users/ejd#/Users/missioncontrol#g' "$file"
  fi
  if /usr/bin/grep -q '/Users/ejd' "$file"; then
    fail "old username remains in $file"
  fi
done

echo "Active OpsBot and OpenClaw configuration paths now target $EXPECTED_HOME."
echo "Production services are still not installed or started."
