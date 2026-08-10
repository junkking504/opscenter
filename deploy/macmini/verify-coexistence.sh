#!/bin/zsh
set -euo pipefail

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
APP_DIR="$EXPECTED_HOME/opscenter-v2/opscenter"
DATA_DIR="$EXPECTED_HOME/.openclaw/workspace/opsbot/data"
CONFIG_DIR="$EXPECTED_HOME/Library/Application Support/OpsCenter"
PRODUCTION_ENV="$CONFIG_DIR/production.env"
PREVIEW_ENV="$CONFIG_DIR/macmini-preview.env"
PRODUCTION_LABEL="com.openclaw.opscenter"
PREVIEW_LABEL="com.openclaw.opscenter.macmini-preview"
REQUIRE_PREVIEW_KERNEL=false
FAILURES=0
WARNINGS=0

if [[ "${1:-}" == "--require-preview-kernel" ]]; then
  REQUIRE_PREVIEW_KERNEL=true
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--require-preview-kernel]" >&2
  exit 64
fi

pass() { echo "PASS  $*"; }
warn() { echo "WARN  $*"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "FAIL  $*" >&2; FAILURES=$((FAILURES + 1)); }

service_loaded() {
  launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1
}

check_local_listener() {
  local port="$1"
  local label="$2"
  local listeners
  listeners="$(/usr/sbin/lsof -nP -a -iTCP:"$port" -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n//p')"
  if [[ "$listeners" == "127.0.0.1:$port" ]]; then
    pass "$label listens only on 127.0.0.1:$port"
  elif [[ -z "$listeners" ]]; then
    fail "$label has no listener on port $port"
  else
    fail "$label has an unexpected listener: ${listeners//$'\n'/, }"
  fi
}

check_runtime() {
  local port="$1"
  local expected_runtime="$2"
  local label="$3"
  local payload
  payload="$(curl -sS --max-time 5 "http://127.0.0.1:$port/api/health" || true)"
  if [[ "$payload" == *"\"runtime\":\"$expected_runtime\""* ]]; then
    pass "$label reports runtime $expected_runtime"
  else
    fail "$label health endpoint did not report runtime $expected_runtime"
  fi
  if [[ "$payload" == *'"ok":false'* ]]; then
    warn "$label health endpoint reports an unhealthy aggregate state"
  fi
}

check_login() {
  local port="$1"
  local label="$2"
  local allowed_pattern="$3"
  local http_status
  http_status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/login" || true)"
  if [[ "$http_status" == ${~allowed_pattern} ]]; then
    pass "$label login responds locally with HTTP $http_status"
  else
    fail "$label login returned HTTP ${http_status:-unreachable}"
  fi
}

check_mode() {
  local file="$1"
  local expected="$2"
  local label="$3"
  local actual
  actual="$(stat -f '%Lp' "$file" 2>/dev/null || true)"
  [[ "$actual" == "$expected" ]] && pass "$label mode is $expected" || fail "$label mode is ${actual:-unavailable}; expected $expected"
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] && pass "running as $EXPECTED_USER" || fail "expected user $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] && pass "home directory is $EXPECTED_HOME" || fail "unexpected HOME: $HOME"
[[ -L "$APP_DIR" ]] && pass "live application path is a release symlink" || fail "$APP_DIR must be a release symlink"
[[ -d "$DATA_DIR" ]] && pass "authoritative OpsBot data exists" || fail "missing authoritative OpsBot data"

if [[ -L "$APP_DIR/data" && "$(readlink "$APP_DIR/data")" == "$DATA_DIR" ]]; then
  pass "application data link targets authoritative Mission Control data"
else
  fail "application data link is missing or incorrect"
fi

for label in \
  "$PRODUCTION_LABEL" \
  "$PREVIEW_LABEL" \
  com.openclaw.opsbot.junkware-collector \
  com.openclaw.opsbot.junkware-history-reconciliation \
  com.openclaw.opsbot.browser-keepalive \
  com.cloudflare.opscenter-tunnel
do
  service_loaded "$label" && pass "launch service is loaded: $label" || fail "required launch service is unloaded: $label"
done

check_local_listener 3000 "production OpsCenter"
check_local_listener 3100 "preview OpsCenter"
check_runtime 3000 "MISSION_CONTROL" "production OpsCenter"
check_runtime 3100 "MAC_MINI_PREVIEW" "preview OpsCenter"
check_login 3000 "production OpsCenter" "200"
check_login 3100 "preview OpsCenter" "200|307"

[[ -f "$PRODUCTION_ENV" ]] && pass "production environment exists" || fail "missing production environment"
[[ -f "$PREVIEW_ENV" ]] && pass "preview environment exists" || fail "missing preview environment"
[[ -f "$PRODUCTION_ENV" ]] && check_mode "$PRODUCTION_ENV" 600 "production environment"
[[ -f "$PREVIEW_ENV" ]] && check_mode "$PREVIEW_ENV" 600 "preview environment"

if [[ -f "$PRODUCTION_ENV" ]] && grep -q '^OPSCENTER_KERNEL_ENABLED=1$' "$PRODUCTION_ENV"; then
  fail "production platform kernel must remain disabled during preview validation"
else
  pass "production platform kernel is not enabled"
fi

if $REQUIRE_PREVIEW_KERNEL; then
  if grep -q '^OPSCENTER_KERNEL_ENABLED=1$' "$PREVIEW_ENV" \
      && grep -q '^OPSCENTER_PREVIEW_DATABASE_URL=postgres' "$PREVIEW_ENV"; then
    pass "preview platform kernel configuration is present"
  else
    fail "preview platform kernel configuration is incomplete"
  fi
  if "$(dirname "$0")/verify-postgres-preview.sh" >/dev/null; then
    pass "preview PostgreSQL isolation checks pass"
  else
    fail "preview PostgreSQL isolation checks failed"
  fi
fi

if (( FAILURES > 0 )); then
  echo
  echo "$FAILURES coexistence verification check(s) failed; $WARNINGS warning(s)." >&2
  exit 1
fi

echo
echo "Mission Control production and preview coexistence checks passed with $WARNINGS warning(s)."
