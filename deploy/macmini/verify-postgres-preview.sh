#!/bin/zsh
set -euo pipefail

EXPECTED_HOME="/Users/missioncontrol"
CONFIG_DIR="$EXPECTED_HOME/Library/Application Support/OpsCenter"
DATA_DIR="$CONFIG_DIR/postgres-preview"
SOCKET_DIR="$CONFIG_DIR/postgres-preview-socket"
POSTGRES_BIN="/opt/homebrew/opt/postgresql@18/bin"
LABEL="com.openclaw.opscenter.postgres-preview"
PORT="55432"
DATABASE="opscenter_preview"
APP_ROLE="opscenter_preview_app"
FAILURES=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*" >&2; FAILURES=$((FAILURES + 1)); }

[[ "$(id -un)" == "missioncontrol" ]] && pass "running as missioncontrol" || fail "expected missioncontrol user"
[[ -f "$DATA_DIR/PG_VERSION" ]] && pass "preview cluster exists" || fail "preview cluster is missing"
[[ "$(stat -f '%Lp' "$DATA_DIR" 2>/dev/null || true)" == "700" ]] && pass "preview data directory mode is 700" || fail "preview data directory mode is not 700"
[[ "$(stat -f '%Lp' "$SOCKET_DIR" 2>/dev/null || true)" == "700" ]] && pass "preview socket directory mode is 700" || fail "preview socket directory mode is not 700"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  pass "preview PostgreSQL launch service is loaded"
else
  fail "preview PostgreSQL launch service is unloaded"
fi

if launchctl print "gui/$(id -u)/homebrew.mxcl.postgresql@18" >/dev/null 2>&1; then
  fail "Homebrew default PostgreSQL service is loaded"
else
  pass "Homebrew default PostgreSQL service is unloaded"
fi

if "$POSTGRES_BIN/pg_isready" -q -h "$SOCKET_DIR" -p "$PORT" -d "$DATABASE" -U "$APP_ROLE"; then
  pass "preview database accepts app-role socket connections"
else
  fail "preview database is unavailable"
fi

if /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "preview PostgreSQL unexpectedly has a TCP listener on port $PORT"
else
  pass "preview PostgreSQL has no TCP listener"
fi

if [[ "$("$POSTGRES_BIN/psql" -h "$SOCKET_DIR" -p "$PORT" -U "$APP_ROLE" -d "$DATABASE" -Atqc "SELECT current_database()" 2>/dev/null || true)" == "$DATABASE" ]]; then
  pass "app role is connected to the preview database"
else
  fail "app role could not verify the preview database"
fi

if (( FAILURES > 0 )); then
  echo
  echo "$FAILURES preview PostgreSQL verification check(s) failed." >&2
  exit 1
fi

echo
echo "OpsCenter preview PostgreSQL is healthy and isolated."
