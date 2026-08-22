#!/bin/bash
set -u

USER_HOME="${HOME:?HOME must be set}"
OPSCENTER_DIR="${OPSCENTER_DIR:-$USER_HOME/opscenter-v2/opscenter}"
OPSBOT_DIR="${OPSBOT_DIR:-$USER_HOME/.openclaw/workspace/opsbot}"
OPSBOT_REFRESH_LOCK="$OPSBOT_DIR/tmp/opscenter_refresh.lock"
export PYTHONPYCACHEPREFIX="/private/tmp/opscenter-history-pycache"

cd "$OPSCENTER_DIR"

WAITED_SECONDS=0
while [ -d "$OPSBOT_REFRESH_LOCK" ] && [ "$WAITED_SECONDS" -lt 600 ]
do
  sleep 5
  WAITED_SECONDS=$((WAITED_SECONDS + 5))
done

python3 scripts/reconcile-junkware-monthly.py --previous-months 1 --lock-wait-seconds 600

# JunkWare may correct a prior closeout up or down. Either non-trivial
# direction requires a lookback refresh; only checking positive deltas lets a
# stale overstatement persist indefinitely.
LOOKBACK_NEEDED=$(python3 -c 'import json; from datetime import datetime; from pathlib import Path; month=datetime.now().strftime("%Y-%m"); path=Path("data/history/monthly_metrics")/f"monthly_metrics_{month}.json"; payload=json.loads(path.read_text()) if path.exists() else {}; print("1" if abs(int(payload.get("unreconciled_completed_jobs") or 0)) > 0 or abs(float(payload.get("unreconciled_gross_revenue") or 0)) > 0.01 else "0")')

if [ "$LOOKBACK_NEEDED" = "1" ]; then
  python3 scripts/reconcile-junkware-lookback.py --days 7
  python3 scripts/reconcile-junkware-monthly.py --previous-months 1 --lock-wait-seconds 600
fi

PAYMENT_DATE=$(date +%F)
python3 scripts/collect-payment-reconciliation.py --date "$PAYMENT_DATE"
