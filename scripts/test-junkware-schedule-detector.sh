#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DETECTOR="$SCRIPT_DIR/run-junkware-schedule-detector.sh"

bash -n "$DETECTOR"

grep -Fq 'DATE_OVERRIDE="${1:-}"' "$DETECTOR"
grep -Fq 'run_date="${DATE_OVERRIDE:-$(TZ=America/Chicago date +%F)}"' "$DETECTOR"
grep -Fq 'collect_junkware_daily.py --date "$run_date" --schedule-only' "$DETECTOR"
grep -Fq -- '--date "$run_date" \' "$DETECTOR"

echo "JunkWare schedule detector date-rollover checks passed."
