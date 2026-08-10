#!/usr/bin/env python3
"""Re-scrape recent JunkWare dates when monthly totals exceed itemized history."""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


TIMEZONE = ZoneInfo("America/Chicago")
OPSBOT_ROOT = Path(
    os.environ.get("OPSBOT_DIR")
    or Path.home() / ".openclaw" / "workspace" / "opsbot"
).expanduser()
MONTHLY_DIR = OPSBOT_ROOT / "data" / "history" / "monthly_metrics"
JUNKWARE_DIR = OPSBOT_ROOT / "data" / "history" / "junkware"
REFRESH_SCRIPT = OPSBOT_ROOT / "scripts" / "run_opscenter_refresh.sh"
REFRESH_LOCK = OPSBOT_ROOT / "tmp" / "opscenter_refresh.lock"
AUDIT_PATH = OPSBOT_ROOT / "data" / "audits" / "junkware_lookback_latest.json"


def money(value: object) -> float:
    cleaned = "".join(character for character in str(value or "") if character in "0123456789.-")
    return float(cleaned) if cleaned not in ("", "-", ".") else 0.0


def completed_totals(month: str) -> tuple[int, float]:
    jobs = 0
    revenue = 0.0
    for path in sorted(JUNKWARE_DIR.glob(f"junkware_completed_{month}-*_summary.csv")):
        with path.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                status = str(row.get("job_status") or "").lower()
                appointment_type = str(row.get("appointment_type") or "").lower()
                if "complete" not in status or "estimate" in appointment_type:
                    continue
                jobs += 1
                revenue += money(row.get("revenue"))
    return jobs, round(revenue, 2)


def read_month(month: str) -> dict:
    path = MONTHLY_DIR / f"monthly_metrics_{month}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def wait_for_refresh_lock(timeout_seconds: int = 600) -> None:
    deadline = time.monotonic() + timeout_seconds
    while REFRESH_LOCK.exists():
        if time.monotonic() >= deadline:
            raise TimeoutError("Timed out waiting for the live refresh lock")
        time.sleep(5)


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", help="Month to reconcile in YYYY-MM format")
    parser.add_argument("--days", type=int, default=2, help="Number of recent dates to retry")
    parser.add_argument("--date", action="append", dest="dates", help="Specific date to retry; repeatable")
    args = parser.parse_args()

    today = datetime.now(TIMEZONE).date()
    month = args.month or today.strftime("%Y-%m")
    authority = read_month(month)
    authoritative_jobs = int(authority.get("completed_jobs") or 0)
    authoritative_revenue = money(authority.get("gross_revenue"))
    before_jobs, before_revenue = completed_totals(month)
    before_job_delta = authoritative_jobs - before_jobs
    before_revenue_delta = round(authoritative_revenue - before_revenue, 2)

    if before_job_delta <= 0 and before_revenue_delta <= 0.01:
        print(json.dumps({"status": "not_needed", "month": month}))
        return 0

    if args.dates:
        dates = list(dict.fromkeys(args.dates))
    else:
        count = max(1, min(args.days, 7))
        dates = [(today - timedelta(days=offset)).isoformat() for offset in range(1, count + 1)]
        dates.append(today.isoformat())

    attempts = []
    for date in dates:
        wait_for_refresh_lock()
        result = subprocess.run([str(REFRESH_SCRIPT), date], cwd=OPSBOT_ROOT, check=False)
        jobs, revenue = completed_totals(month)
        attempts.append({
            "date": date,
            "exit_code": result.returncode,
            "stored_jobs": jobs,
            "stored_revenue": revenue,
            "remaining_jobs": authoritative_jobs - jobs,
            "remaining_revenue": round(authoritative_revenue - revenue, 2),
        })
        if authoritative_jobs - jobs <= 0 and authoritative_revenue - revenue <= 0.01:
            break

    after_jobs, after_revenue = completed_totals(month)
    audit = {
        "status": "reconciled" if authoritative_jobs == after_jobs and abs(authoritative_revenue - after_revenue) <= 0.01 else "still_unreconciled",
        "verified_at": datetime.now(TIMEZONE).isoformat(),
        "month": month,
        "authoritative_jobs": authoritative_jobs,
        "authoritative_revenue": authoritative_revenue,
        "before_jobs": before_jobs,
        "before_revenue": before_revenue,
        "after_jobs": after_jobs,
        "after_revenue": after_revenue,
        "remaining_jobs": authoritative_jobs - after_jobs,
        "remaining_revenue": round(authoritative_revenue - after_revenue, 2),
        "attempts": attempts,
    }
    atomic_json(AUDIT_PATH, audit)
    print(json.dumps(audit, indent=2))
    return 0 if all(attempt["exit_code"] == 0 for attempt in attempts) else 1


if __name__ == "__main__":
    raise SystemExit(main())
