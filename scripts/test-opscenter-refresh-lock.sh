#!/bin/bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DIR="$(mktemp -d /tmp/opscenter-refresh-lock.XXXXXX)"
LOCK_DIR="$TEST_DIR/opscenter_refresh.lock"
trap 'rm -rf "$TEST_DIR"' EXIT

# shellcheck source=opscenter-refresh-lock.sh
source "$ROOT/scripts/opscenter-refresh-lock.sh"

mkdir "$LOCK_DIR"
touch -t "$(date -v-20M '+%Y%m%d%H%M.%S')" "$LOCK_DIR"
OPSCENTER_REFRESH_LOCK_DIR="$LOCK_DIR" OPSCENTER_REFRESH_LOCK_MAX_AGE_SECONDS=30 \
  recover_abandoned_opscenter_refresh_lock
[[ ! -d "$LOCK_DIR" ]] || { echo "expired lock was not recovered" >&2; exit 1; }

mkdir "$LOCK_DIR"
OPSCENTER_REFRESH_LOCK_DIR="$LOCK_DIR" OPSCENTER_REFRESH_LOCK_MAX_AGE_SECONDS=900 \
  recover_abandoned_opscenter_refresh_lock
[[ -d "$LOCK_DIR" ]] || { echo "fresh lock was removed" >&2; exit 1; }

echo "OpsCenter refresh lock recovery tests passed."
