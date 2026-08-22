#!/bin/bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
LOCK_HELPER="$ROOT_DIR/scripts/linxup-lock.sh"
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/opscenter-linxup-lock-test.XXXXXX")
HOLDER_PID=""

cleanup_test() {
  if [[ -n "$HOLDER_PID" ]] && kill -0 "$HOLDER_PID" 2>/dev/null; then
    kill "$HOLDER_PID" 2>/dev/null || true
    wait "$HOLDER_PID" 2>/dev/null || true
  fi
  find "$TEST_DIR" -type f -maxdepth 3 -delete 2>/dev/null || true
  find "$TEST_DIR" -type d -depth -maxdepth 3 -exec rmdir {} \; 2>/dev/null || true
}
trap cleanup_test EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

expect_status() {
  local expected="$1"
  shift
  set +e
  "$@"
  local actual=$?
  set -e
  [[ "$actual" == "$expected" ]] || fail "expected exit $expected, got $actual: $*"
}

metadata_lock="$TEST_DIR/metadata.lock"
LINXUP_LOCK_DIR="$metadata_lock"
LINXUP_LOCK_OWNER_KIND="test"
LINXUP_LOCK_MAX_AGE_SECONDS=30
. "$LOCK_HELPER"
linxup_lock_acquire
grep -q "^pid=$$\$" "$metadata_lock/owner" || fail "owner PID was not recorded"
grep -q '^started_epoch=[0-9][0-9]*$' "$metadata_lock/owner" || fail "start epoch was not recorded"
grep -q '^started_at=.*Z$' "$metadata_lock/owner" || fail "start timestamp was not recorded"
linxup_lock_release
[[ ! -e "$metadata_lock" ]] || fail "owned lock was not released"

active_lock="$TEST_DIR/active.lock"
ready_file="$TEST_DIR/holder.ready"
LINXUP_LOCK_DIR="$active_lock" LINXUP_LOCK_OWNER_KIND="holder" LINXUP_LOCK_MAX_AGE_SECONDS=30 \
  bash -c '. "$1"; linxup_lock_acquire; trap linxup_lock_release EXIT; : > "$2"; sleep 30' \
  bash "$LOCK_HELPER" "$ready_file" &
HOLDER_PID=$!
for _ in 1 2 3 4 5; do
  [[ -f "$ready_file" ]] && break
  sleep 1
done
[[ -f "$ready_file" ]] || fail "active-lock holder did not start"
expect_status 75 env LINXUP_LOCK_DIR="$active_lock" LINXUP_LOCK_OWNER_KIND="contender" LINXUP_LOCK_MAX_AGE_SECONDS=30 \
  bash -c '. "$1"; linxup_lock_acquire' bash "$LOCK_HELPER"
kill "$HOLDER_PID"
wait "$HOLDER_PID" 2>/dev/null || true
HOLDER_PID=""
[[ ! -e "$active_lock" ]] || fail "active holder did not release its lock"

dead_lock="$TEST_DIR/dead.lock"
mkdir "$dead_lock"
cat > "$dead_lock/owner" <<EOF
pid=999999
started_epoch=$(date +%s)
started_at=2026-08-22T00:00:00Z
owner_kind=dead-test
owner_token=dead-test-token
EOF
LINXUP_LOCK_DIR="$dead_lock"
LINXUP_LOCK_OWNER_KIND="dead-recovery"
LINXUP_LOCK_MAX_AGE_SECONDS=30
linxup_lock_acquire
grep -q "^pid=$$\$" "$dead_lock/owner" || fail "dead owner was not replaced"
linxup_lock_release

old_lock="$TEST_DIR/old.lock"
mkdir "$old_lock"
old_epoch=$(( $(date +%s) - 120 ))
cat > "$old_lock/owner" <<EOF
pid=$$
started_epoch=$old_epoch
started_at=2026-08-22T00:00:00Z
owner_kind=old-test
owner_token=old-test-token
EOF
LINXUP_LOCK_DIR="$old_lock"
LINXUP_LOCK_OWNER_KIND="age-recovery"
LINXUP_LOCK_MAX_AGE_SECONDS=30
linxup_lock_acquire
new_token=$(sed -n 's/^owner_token=//p' "$old_lock/owner")
[[ "$new_token" != "old-test-token" ]] || fail "over-age live-PID lock was not replaced"
linxup_lock_release

replacement_lock="$TEST_DIR/replacement.lock"
LINXUP_LOCK_DIR="$replacement_lock"
LINXUP_LOCK_OWNER_KIND="original"
LINXUP_LOCK_MAX_AGE_SECONDS=30
linxup_lock_acquire
original_token="$LINXUP_LOCK_TOKEN"
mv "$replacement_lock" "$replacement_lock.old"
mkdir "$replacement_lock"
cat > "$replacement_lock/owner" <<EOF
pid=$$
started_epoch=$(date +%s)
started_at=2026-08-22T00:00:00Z
owner_kind=replacement
owner_token=replacement-token
EOF
LINXUP_LOCK_TOKEN="$original_token"
linxup_lock_release
[[ -d "$replacement_lock" ]] || fail "old owner removed a replacement lock"
rm -f "$replacement_lock/owner" "$replacement_lock.old/owner"
rmdir "$replacement_lock" "$replacement_lock.old"

echo "LinxUp lock checks passed."
