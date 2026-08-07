#!/bin/zsh
set -euo pipefail

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
DATA_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/data"
DATA_LINK="$APP_DIR/data"
PREVIEW_ENV_DIR="$EXPECTED_HOME/Library/Application Support/OpsCenter"
PREVIEW_ENV="$PREVIEW_ENV_DIR/macmini-preview.env"
SOURCE_PLIST="$APP_DIR/deploy/macmini/launchd/com.openclaw.opscenter.macmini-preview.plist"
INSTALLED_PLIST="$EXPECTED_HOME/Library/LaunchAgents/com.openclaw.opscenter.macmini-preview.plist"
PREVIEW_LABEL="com.openclaw.opscenter.macmini-preview"

fail() {
  echo "Mac Mini preview install stopped: $*" >&2
  exit 1
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ -d "$APP_DIR" ]] || fail "missing $APP_DIR"
[[ -d "$DATA_DIR" ]] || fail "copy the OpsBot data snapshot to $DATA_DIR first"
[[ -f "$SOURCE_PLIST" ]] || fail "missing preview launch configuration"

for label in \
  com.openclaw.opscenter \
  com.openclaw.opsbot.junkware-collector \
  com.openclaw.opsbot.junkware-history-reconciliation \
  com.openclaw.opsbot.browser-keepalive \
  com.cloudflare.opscenter-tunnel
do
  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    fail "production service is already loaded: $label"
  fi
done

for command in node npm openssl curl plutil; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

if [[ -L "$DATA_LINK" ]]; then
  current_target="$(readlink "$DATA_LINK")"
  if [[ "$current_target" == "$DATA_DIR" ]]; then
    :
  elif [[ "$current_target" == "/Users/ejd/.openclaw/workspace/opsbot/data" ]]; then
    old_link="$APP_DIR/data.pre-macmini-link"
    [[ ! -e "$old_link" && ! -L "$old_link" ]] || fail "backup link already exists: $old_link"
    mv "$DATA_LINK" "$old_link"
    ln -s "$DATA_DIR" "$DATA_LINK"
  else
    fail "data link points to an unexpected location: $current_target"
  fi
elif [[ -e "$DATA_LINK" ]]; then
  fail "$DATA_LINK exists but is not a symbolic link"
else
  ln -s "$DATA_DIR" "$DATA_LINK"
fi

mkdir -p "$PREVIEW_ENV_DIR" "$EXPECTED_HOME/Library/LaunchAgents" "$APP_DIR/logs"
chmod 700 "$PREVIEW_ENV_DIR"

if [[ ! -f "$PREVIEW_ENV" ]]; then
  umask 077
  preview_secret="$(openssl rand -hex 48)"
  [[ -n "$preview_secret" ]] || fail "could not generate preview authentication secret"
  print -r -- "OPS_AUTH_SESSION_SECRET=$preview_secret" > "$PREVIEW_ENV"
fi
chmod 600 "$PREVIEW_ENV"

chmod 755 "$APP_DIR/deploy/macmini/run-preview.sh" "$APP_DIR/deploy/macmini/verify-preview.sh"
plutil -lint "$SOURCE_PLIST"

cd "$APP_DIR"
npm ci
NEXT_DIST_DIR="tmp/macmini-preview-next" npm run build

/usr/bin/install -m 644 "$SOURCE_PLIST" "$INSTALLED_PLIST"
launchctl bootout "gui/$(id -u)/$PREVIEW_LABEL" >/dev/null 2>&1 || true
launchctl enable "gui/$(id -u)/$PREVIEW_LABEL"
launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PLIST"

echo
echo "Mac Mini preview installed."
echo "Local URL: http://127.0.0.1:3100"
echo "Collectors, scheduled reconciliation, VPS sync, and Cloudflare Tunnel remain disabled."
echo "Run deploy/macmini/verify-preview.sh to verify isolation."
