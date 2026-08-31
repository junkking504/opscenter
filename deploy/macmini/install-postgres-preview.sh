#!/bin/zsh
set -euo pipefail

EXPECTED_USER="missioncontrol"
EXPECTED_HOME="/Users/missioncontrol"
CONFIG_DIR="$EXPECTED_HOME/Library/Application Support/OpsCenter"
LOG_DIR="$EXPECTED_HOME/Library/Logs/OpsCenter"
DATA_DIR="$CONFIG_DIR/postgres-preview"
SOCKET_DIR="$CONFIG_DIR/postgres-preview-socket"
BACKUP_DIR="$CONFIG_DIR/postgres-preview-backups"
PREVIEW_ENV="$CONFIG_DIR/macmini-preview.env"
POSTGRES_BIN="/opt/homebrew/opt/postgresql@18/bin"
SOURCE_PLIST="$(cd "$(dirname "$0")" && pwd)/launchd/com.openclaw.opscenter.postgres-preview.plist"
INSTALLED_PLIST="$EXPECTED_HOME/Library/LaunchAgents/com.openclaw.opscenter.postgres-preview.plist"
LABEL="com.openclaw.opscenter.postgres-preview"
PORT="55432"
DATABASE="opscenter_preview"
APP_ROLE="opscenter_preview_app"
CONNECTION_URL="postgresql://$APP_ROLE@localhost/$DATABASE?host=%2FUsers%2Fmissioncontrol%2FLibrary%2FApplication%20Support%2FOpsCenter%2Fpostgres-preview-socket&port=$PORT"

fail() {
  echo "OpsCenter preview PostgreSQL install stopped: $*" >&2
  exit 1
}

replace_env_value() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp "$CONFIG_DIR/.macmini-preview.env.XXXXXX")"
  chmod 600 "$temporary"
  awk -F= -v target="$key" '$1 != target { print }' "$PREVIEW_ENV" > "$temporary"
  print -r -- "$key=$value" >> "$temporary"
  /bin/mv -f "$temporary" "$PREVIEW_ENV"
  chmod 600 "$PREVIEW_ENV"
}

wait_for_postgres() {
  local attempt=1
  while (( attempt <= 30 )); do
    if "$POSTGRES_BIN/pg_isready" -q -h "$SOCKET_DIR" -p "$PORT" -d postgres; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "run this while logged in as $EXPECTED_USER"
[[ "$HOME" == "$EXPECTED_HOME" ]] || fail "HOME must be $EXPECTED_HOME"
[[ -x "$POSTGRES_BIN/postgres" ]] || fail "install Homebrew postgresql@18 first"
[[ -x "$POSTGRES_BIN/initdb" ]] || fail "missing initdb"
[[ -f "$SOURCE_PLIST" ]] || fail "missing preview PostgreSQL launch configuration"
[[ -f "$PREVIEW_ENV" ]] || fail "missing preview environment"

"$(dirname "$0")/verify-coexistence.sh"

if launchctl print "gui/$(id -u)/homebrew.mxcl.postgresql@18" >/dev/null 2>&1; then
  fail "the Homebrew default PostgreSQL service must remain unloaded"
fi

mkdir -p "$CONFIG_DIR" "$LOG_DIR" "$SOCKET_DIR" "$BACKUP_DIR" "$EXPECTED_HOME/Library/LaunchAgents"
chmod 700 "$CONFIG_DIR" "$SOCKET_DIR" "$BACKUP_DIR"

if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
  [[ ! -e "$DATA_DIR" ]] || fail "$DATA_DIR exists without a PostgreSQL cluster"
  "$POSTGRES_BIN/initdb" \
    --pgdata="$DATA_DIR" \
    --encoding=UTF8 \
    --locale=C \
    --auth-local=trust \
    --auth-host=scram-sha-256
fi
chmod 700 "$DATA_DIR"

CUSTOM_CONFIG="$DATA_DIR/opscenter-preview.conf"
CUSTOM_HBA="$DATA_DIR/opscenter-preview-hba.conf"
{
  print -r -- "listen_addresses = ''"
  print -r -- "port = $PORT"
  print -r -- "unix_socket_directories = '$SOCKET_DIR'"
  print -r -- "unix_socket_permissions = 0700"
  print -r -- "hba_file = '$CUSTOM_HBA'"
  print -r -- "password_encryption = 'scram-sha-256'"
  print -r -- "logging_collector = off"
  print -r -- "log_connections = on"
  print -r -- "log_disconnections = on"
} > "$CUSTOM_CONFIG"
chmod 600 "$CUSTOM_CONFIG"

{
  print -r -- "local $DATABASE $APP_ROLE trust"
  print -r -- "local opscenter_preview_restore_test $APP_ROLE trust"
  print -r -- "local all $EXPECTED_USER trust"
  print -r -- "local all all reject"
} > "$CUSTOM_HBA"
chmod 600 "$CUSTOM_HBA"

if ! grep -Fxq "include_if_exists = 'opscenter-preview.conf'" "$DATA_DIR/postgresql.conf"; then
  print -r -- "include_if_exists = 'opscenter-preview.conf'" >> "$DATA_DIR/postgresql.conf"
fi

plutil -lint "$SOURCE_PLIST"
if [[ ! -f "$INSTALLED_PLIST" ]] || ! cmp -s "$SOURCE_PLIST" "$INSTALLED_PLIST"; then
  /usr/bin/install -m 644 "$SOURCE_PLIST" "$INSTALLED_PLIST"
fi
launchctl enable "gui/$(id -u)/$LABEL"
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
else
  launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PLIST"
fi
wait_for_postgres || fail "preview PostgreSQL did not become ready"

if [[ "$("$POSTGRES_BIN/psql" -h "$SOCKET_DIR" -p "$PORT" -d postgres -Atqc "SELECT 1 FROM pg_roles WHERE rolname = '$APP_ROLE'")" != "1" ]]; then
  "$POSTGRES_BIN/createuser" -h "$SOCKET_DIR" -p "$PORT" --no-createdb --no-createrole --no-superuser "$APP_ROLE"
fi
if [[ "$("$POSTGRES_BIN/psql" -h "$SOCKET_DIR" -p "$PORT" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DATABASE'")" != "1" ]]; then
  "$POSTGRES_BIN/createdb" -h "$SOCKET_DIR" -p "$PORT" --owner="$APP_ROLE" "$DATABASE"
fi

replace_env_value "OPSCENTER_KERNEL_ENABLED" "1"
replace_env_value "OPSCENTER_PREVIEW_DATABASE_URL" "$CONNECTION_URL"

echo
echo "OpsCenter preview PostgreSQL is installed and ready."
echo "Database: $DATABASE"
echo "Socket:   $SOCKET_DIR"
echo "Port:     $PORT (Unix socket only; no TCP listener)"
echo "Production environment and OpsCenter services were not changed."
