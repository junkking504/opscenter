#!/bin/zsh
set -euo pipefail

EXPECTED_HOME="/Users/missioncontrol"
CONFIG_DIR="$EXPECTED_HOME/Library/Application Support/OpsCenter"
SOCKET_DIR="$CONFIG_DIR/postgres-preview-socket"
BACKUP_DIR="$CONFIG_DIR/postgres-preview-backups"
POSTGRES_BIN="/opt/homebrew/opt/postgresql@18/bin"
PORT="55432"
DATABASE="opscenter_preview"
RESTORE_DATABASE="opscenter_preview_restore_test"
APP_ROLE="opscenter_preview_app"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/opscenter_preview_$TIMESTAMP.dump"

fail() {
  echo "OpsCenter preview backup test stopped: $*" >&2
  exit 1
}

[[ "$(id -un)" == "missioncontrol" ]] || fail "run this as missioncontrol"
[[ -d "$BACKUP_DIR" ]] || fail "missing backup directory"
"$(dirname "$0")/verify-postgres-preview.sh"

umask 077
"$POSTGRES_BIN/pg_dump" \
  -h "$SOCKET_DIR" \
  -p "$PORT" \
  -U "$APP_ROLE" \
  -d "$DATABASE" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_FILE"
[[ -s "$BACKUP_FILE" ]] || fail "backup file is empty"
chmod 600 "$BACKUP_FILE"

if [[ "$("$POSTGRES_BIN/psql" -h "$SOCKET_DIR" -p "$PORT" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$RESTORE_DATABASE'")" == "1" ]]; then
  fail "restore-test database already exists and requires inspection"
fi

"$POSTGRES_BIN/createdb" -h "$SOCKET_DIR" -p "$PORT" --owner="$APP_ROLE" "$RESTORE_DATABASE"
cleanup() {
  "$POSTGRES_BIN/dropdb" -h "$SOCKET_DIR" -p "$PORT" --if-exists "$RESTORE_DATABASE" >/dev/null
}
trap cleanup EXIT INT TERM

"$POSTGRES_BIN/pg_restore" \
  -h "$SOCKET_DIR" \
  -p "$PORT" \
  -U "$APP_ROLE" \
  -d "$RESTORE_DATABASE" \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  "$BACKUP_FILE"

MIGRATION_VERSION="$("$POSTGRES_BIN/psql" -h "$SOCKET_DIR" -p "$PORT" -U "$APP_ROLE" -d "$RESTORE_DATABASE" -Atqc "SELECT MAX(version) FROM opscenter_kernel.schema_migrations")"
[[ -n "$MIGRATION_VERSION" ]] || fail "restored database has no kernel migration version"

cleanup
trap - EXIT INT TERM

echo
echo "Preview PostgreSQL backup and restore test passed."
echo "Backup file: $BACKUP_FILE"
echo "Migration:   $MIGRATION_VERSION"
echo "Temporary restore database was removed."
