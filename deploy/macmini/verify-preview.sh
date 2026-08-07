#!/bin/zsh
set -euo pipefail

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
DATA_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/data"
PREVIEW_LABEL="com.openclaw.opscenter.macmini-preview"
FAILURES=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*" >&2; FAILURES=$((FAILURES + 1)); }

[[ "$(id -un)" == "$EXPECTED_USER" ]] && pass "running as $EXPECTED_USER" || fail "expected user $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] && pass "home directory is $EXPECTED_HOME" || fail "unexpected HOME: $HOME"
[[ -d "$APP_DIR" ]] && pass "application directory exists" || fail "missing application directory"
[[ -d "$DATA_DIR" ]] && pass "preview data exists" || fail "missing preview data"

if [[ -L "$APP_DIR/data" && "$(readlink "$APP_DIR/data")" == "$DATA_DIR" ]]; then
  pass "application data link targets the missioncontrol snapshot"
else
  fail "application data link is missing or incorrect"
fi

if launchctl print "gui/$(id -u)/$PREVIEW_LABEL" >/dev/null 2>&1; then
  pass "preview launch service is loaded"
else
  fail "preview launch service is not loaded"
fi

for label in \
  com.openclaw.opscenter \
  com.openclaw.opsbot.junkware-collector \
  com.openclaw.opsbot.junkware-history-reconciliation \
  com.openclaw.opsbot.browser-keepalive \
  com.cloudflare.opscenter-tunnel
do
  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    fail "production service must remain unloaded: $label"
  else
    pass "production service is unloaded: $label"
  fi
done

http_status="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/login || true)"
if [[ "$http_status" == "200" ]]; then
  pass "preview login responds locally with HTTP 200"
else
  fail "preview login returned HTTP ${http_status:-unreachable}"
fi

if (( FAILURES > 0 )); then
  echo
  echo "$FAILURES preview verification check(s) failed." >&2
  exit 1
fi

echo
echo "Mac Mini preview is healthy and isolated from production."
