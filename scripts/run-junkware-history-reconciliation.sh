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

# JunkWare may correct a prior closeout up or down. Recheck both the current
# month and the one completed month already captured above. A closed month
# receives its own end-of-month lookback instead of accidentally retrying
# today's dates.
LOOKBACK_MONTHS=$(python3 -c 'import json; from datetime import datetime; from pathlib import Path; now=datetime.now(); months=[f"{now.year:04d}-{now.month:02d}"]; months.append(f"{now.year - (now.month == 1):04d}-{12 if now.month == 1 else now.month - 1:02d}"); base=Path("data/history/monthly_metrics"); [print(month) for month in months if (lambda p: p.exists() and (lambda payload: abs(int(payload.get("unreconciled_completed_jobs") or 0)) > 0 or abs(float(payload.get("unreconciled_gross_revenue") or 0)) > 0.01)(json.loads(p.read_text())))(base / f"monthly_metrics_{month}.json")]')

for LOOKBACK_MONTH in ${(f)LOOKBACK_MONTHS}; do
  python3 scripts/reconcile-junkware-lookback.py --month "$LOOKBACK_MONTH" --days 7
done

if [[ -n "$LOOKBACK_MONTHS" ]]; then
  python3 scripts/reconcile-junkware-monthly.py --previous-months 1 --lock-wait-seconds 600
fi

PAYMENT_DATE=$(date +%F)
python3 scripts/collect-payment-reconciliation.py --date "$PAYMENT_DATE"
