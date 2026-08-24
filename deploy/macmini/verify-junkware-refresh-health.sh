#!/bin/bash
# Wait for a full JunkWare refresh that has explicitly loaded this immutable
# release. The collector runs independently, so this verifies its real cycle
# without starting a second refresh or writing source data from deployment.
set -Eeuo pipefail

usage() {
  echo "usage: $0 --release <immutable-release-dir> [--log <path>] [--timeout-seconds <seconds>]" >&2
  exit 64
}

release=""
log_file="${OPSCENTER_JUNKWARE_REFRESH_LOG:-${HOME:?HOME must be set}/.openclaw/workspace/opsbot/logs/opscenter_safe_background_refresh.log}"
timeout_seconds="${OPSCENTER_JUNKWARE_REFRESH_HEALTH_TIMEOUT_SECONDS:-420}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --release) release="${2:-}"; shift 2 ;;
    --log) log_file="${2:-}"; shift 2 ;;
    --timeout-seconds) timeout_seconds="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[ -n "$release" ] || usage
[ -d "$release" ] || { echo "JunkWare refresh health failed: release directory is missing: $release" >&2; exit 1; }
[[ "$timeout_seconds" =~ ^[0-9]+$ ]] || { echo "JunkWare refresh health failed: timeout must be an integer." >&2; exit 64; }

release_commit=$(/usr/bin/git -C "$release" rev-parse HEAD)
deadline=$(( $(date +%s) + timeout_seconds ))

while [ "$(date +%s)" -le "$deadline" ]; do
  if [ -f "$log_file" ] && /usr/bin/python3 - "$log_file" "$release_commit" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
commit = sys.argv[2]
try:
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
except OSError:
    raise SystemExit(1)
marker = f"OPSCENTER_COLLECTOR_RELEASE={commit}"
seen_marker = False
for line in lines:
    if marker in line:
        seen_marker = True
        continue
    if seen_marker and "REFRESH COMPLETED SUCCESSFULLY" in line:
        raise SystemExit(0)
raise SystemExit(1)
PY
  then
    echo "JunkWare refresh health passed: a full cycle completed using release $release_commit."
    exit 0
  fi
  sleep 5
done

echo "JunkWare refresh health failed: no full refresh completion was recorded for release $release_commit within ${timeout_seconds}s." >&2
echo "Checked log: $log_file" >&2
exit 1
