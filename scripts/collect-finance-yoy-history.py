#!/usr/bin/env python3
"""Resume a bounded prior-year JunkWare backfill without sending historical alerts."""
import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


def collection_dates(through):
    end = date.fromisoformat(through)
    dates = []
    cursor = date(end.year, 1, 1)
    while cursor <= end:
        dates.append(cursor.isoformat())
        cursor += timedelta(days=1)
    # Finish the current month comparison first, then the most recent full month.
    return sorted(dates, key=lambda value: (-int(value[5:7]), value))


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, indent=2) + '\n')
    temporary.replace(path)


def verify_raw(raw, expected):
    territories = raw.get('territory_verification') or []
    if raw.get('date') != expected or not territories or len(raw.get('markets_scraped') or []) < 4:
        raise ValueError('Historical date or territory coverage is incomplete')
    if {str(row.get('territory_id')) for row in territories} != {'352', '477', '399', '484'} or any(row.get('verified') is not True for row in territories):
        raise ValueError('Historical territory dates do not match')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--through', required=True, help='Prior-year cutoff YYYY-MM-DD')
    parser.add_argument('--pause-seconds', type=int, default=60)
    args = parser.parse_args()
    end = date.fromisoformat(args.through)
    if end.year >= date.today().year or args.pause_seconds < 0:
        parser.error('Use a prior-year cutoff and nonnegative pause')
    root = Path(os.environ.get('OPSBOT_DIR', Path.home() / '.openclaw/workspace/opsbot'))
    state_path = root / 'data/audits' / f'finance_yoy_backfill_{end.year}.json'
    log_dir = root / 'logs' / f'finance-yoy-{end.year}'
    log_dir.mkdir(parents=True, exist_ok=True)
    lock = (log_dir / 'worker.lock').open('w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('YOY backfill already running')
        return
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    completed = state.setdefault('completedDates', [])
    failures = state.setdefault('failedDates', {})
    queue = collection_dates(args.through)
    state.update(through=args.through, pid=os.getpid(), status='running', totalDates=len(queue))
    def save():
        state.update(updatedAt=datetime.now(timezone.utc).isoformat(), pendingCount=sum(d not in completed for d in queue))
        atomic_json(state_path, state)
    save()
    consecutive_failures = 0
    for day in queue:
        if day in completed:
            continue
        state.update(runningDate=day, status='waiting_for_live_refresh')
        save()
        while (root / 'tmp/opscenter_refresh.lock').exists():
            time.sleep(15)
        state['status'] = 'collecting'
        save()
        try:
            with (log_dir / f'{day}.log').open('a') as log:
                env = {**os.environ, 'PYTHONPYCACHEPREFIX': '/private/tmp/opscenter-history-pycache'}
                for script in ['collect_junkware_daily.py', 'collect_junkware_timesheet_rates.py', 'process_daily_metrics.py']:
                    subprocess.run([sys.executable, str(root / 'scripts' / script), '--date', day], cwd=root,
                                   env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=900)
                    if script == 'collect_junkware_daily.py':
                        raw = json.loads((root / 'data/history/junkware' / f'junkware_{day}_raw.json').read_text())
                        verify_raw(raw, day)
            metrics = json.loads((root / 'data/history/daily_metrics' / f'daily_metrics_{day}.json').read_text())
            if metrics.get('date') != day:
                raise ValueError('Published date does not match requested date')
            if metrics.get('inputs', {}).get('missing_hourly_rates'):
                # Revenue/jobs are still usable; incomplete payroll cannot become a zero cost.
                metrics.update(total_expenses=None, net_profit=None, finance_yoy_cost_coverage='missing_historical_rates')
                for metrics_path in [root / 'data/history/daily_metrics' / f'daily_metrics_{day}.json', root / 'data/processed' / f'daily_metrics_{day}.json']:
                    if metrics_path.exists():
                        atomic_json(metrics_path, metrics)
                state.setdefault('incompleteCostDates', []).append(day)
            completed.append(day)
            failures.pop(day, None)
            consecutive_failures = 0
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            # Do not copy raw source output or credentials into the status record.
            failures[day] = {'errorType': type(error).__name__, 'log': str(log_dir / f'{day}.log')}
            consecutive_failures += 1
        save()
        if consecutive_failures >= 3:
            state['status'] = 'needs_attention'
            save()
            return
        time.sleep(args.pause_seconds)
    state.update(status='completed' if not state['pendingCount'] else 'needs_attention', runningDate=None)
    save()


if __name__ == '__main__':
    main()
