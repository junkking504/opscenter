#!/bin/bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT_DIR/scripts/linxup-retry.sh"

attempt_count=0
future_then_valid() {
  attempt_count=$((attempt_count + 1))
  if (( attempt_count == 1 )); then
    echo "Normalized point has a future timestamp" >&2
    return 1
  fi
  return 0
}

linxup_retry 2 0 future_then_valid
[[ "$attempt_count" == "2" ]] || {
  echo "FAIL: validation failure did not trigger a second fetch callback" >&2
  exit 1
}

failure_count=0
always_fails() {
  failure_count=$((failure_count + 1))
  return 42
}

set +e
linxup_retry 2 0 always_fails
final_status=$?
set -e
[[ "$failure_count" == "2" && "$final_status" == "42" ]] || {
  echo "FAIL: exhausted retry did not preserve the collector failure status" >&2
  exit 1
}

echo "LinxUp retry checks passed."
