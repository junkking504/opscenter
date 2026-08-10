#!/usr/bin/env python3
"""Capture JunkWare Dashboard monthly totals and reconcile stored daily data."""

from __future__ import annotations

import argparse
import csv
import fcntl
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


TIMEZONE = ZoneInfo("America/Chicago")
OPSCENTER_ROOT = Path(__file__).resolve().parents[1]
OPSBOT_ROOT = Path(
    os.environ.get("OPSBOT_DIR")
    or Path.home() / ".openclaw" / "workspace" / "opsbot"
).expanduser()
OPSBOT_SCRIPTS = OPSBOT_ROOT / "scripts"
DASHBOARD_URL = "https://junkware.junk-king.com/franchise/dashboard.aspx"
LOCK_PATH = Path("/private/tmp/opscenter-junkware-monthly-reconciliation.lock")


def money(value: object) -> float:
    text = re.sub(r"[^0-9.-]", "", str(value or ""))
    return float(text) if text not in ("", "-", ".") else 0.0


def month_shift(month_key: str, offset: int) -> str:
    year, month = (int(part) for part in month_key.split("-"))
    absolute = year * 12 + month - 1 + offset
    return f"{absolute // 12:04d}-{absolute % 12 + 1:02d}"


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def completed_csv_totals(month_key: str) -> dict:
    base = OPSBOT_ROOT / "data" / "history" / "junkware"
    jobs = 0
    revenue = 0.0
    days = 0
    for path in sorted(base.glob(f"junkware_completed_{month_key}-*_summary.csv")):
        days += 1
        with path.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                status = str(row.get("job_status") or "").lower()
                row_type = str(row.get("appointment_type") or "").lower()
                if "complete" not in status or "estimate" in row_type:
                    continue
                jobs += 1
                revenue += money(row.get("revenue"))
    return {"jobs": jobs, "revenue": round(revenue, 2), "days": days}


def truck_record_totals(month_key: str) -> dict:
    base = OPSBOT_ROOT / "data" / "history" / "junkware"
    jobs = 0
    revenue = 0.0
    days = 0
    for path in sorted(base.glob(f"junkware_truck_records_{month_key}-*.csv")):
        days += 1
        with path.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                jobs += int(float(row.get("jobs") or 0))
                revenue += money(row.get("sales"))
    return {"jobs": jobs, "revenue": round(revenue, 2), "days": days}


def daily_metrics_totals(month_key: str) -> dict:
    base = OPSBOT_ROOT / "data" / "history" / "daily_metrics"
    jobs = 0
    revenue = 0.0
    days = 0
    for path in sorted(base.glob(f"daily_metrics_{month_key}-*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        days += 1
        revenue += float(
            payload.get("total_revenue")
            or payload.get("gross_revenue")
            or payload.get("sales")
            or 0
        )
        jobs_by_market = payload.get("jobs_by_market") or {}
        jobs += sum(int(float(value or 0)) for value in jobs_by_market.values())
    return {"jobs": jobs, "revenue": round(revenue, 2), "days": days}


def select_dashboard_month(collector, month_key: str) -> None:
    collector.ensure_authenticated(DASHBOARD_URL)
    collector.page.evaluate(
        """() => {
          const select = document.getElementById('ctl00_Content_ServiceProviderGroupDD');
          if (!select) throw new Error('Dashboard market selector not found');
          select.value = 'A';
        }"""
    )
    collector.submit_aspnet_form("ctl00$Content$ServiceProviderGroupDD")

    year, month = month_key.split("-")
    dashboard_month = f"{month}/{year}"
    collector.page.evaluate(
        """(value) => {
          const input = document.getElementById('ctl00_Content_OSCMYTB');
          if (!input) throw new Error('Dashboard month input not found');
          input.value = value;
        }""",
        dashboard_month,
    )
    collector.submit_aspnet_form("ctl00$Content$OSCMYTB")


def dashboard_totals(collector, month_key: str) -> dict:
    select_dashboard_month(collector, month_key)
    report = collector.page.evaluate(
        """() => {
          const tables = [...document.querySelectorAll('table.table-2px-cp')];
          const table = tables.find(candidate => {
            const text = String(candidate.innerText || '');
            return text.includes('Completed Jobs:') && text.includes('Total Revenue:');
          });
          if (!table) return { error: 'Monthly Year Over Year table not found' };
          const rows = [...table.querySelectorAll('tr')].map(row =>
            [...row.querySelectorAll('th,td')].map(cell => String(cell.innerText || '').trim())
          );
          return {
            month: document.getElementById('ctl00_Content_OSCMYTB')?.value || '',
            market: document.getElementById('ctl00_Content_ServiceProviderGroupDD')?.value || '',
            rows,
            text: String(table.innerText || '').trim(),
            url: location.href
          };
        }"""
    )
    if report.get("error"):
        raise RuntimeError(report["error"])

    def row_value(label: str) -> str:
        for row in report.get("rows", []):
            if row and row[0].strip().lower() == label.lower():
                if len(row) < 3:
                    break
                return row[2]
        raise RuntimeError(f"Dashboard row not found: {label}")

    jobs = int(money(row_value("Completed Jobs:")))
    revenue = round(money(row_value("Total Revenue:")), 2)
    average = round(money(row_value("Avg Revenue/Job:")), 2)
    return {
        "completed_jobs": jobs,
        "gross_revenue": revenue,
        "average_revenue_per_job": average,
        "report_text": report.get("text", ""),
        "source_url": report.get("url", DASHBOARD_URL),
    }


def reconcile_month(collector, month_key: str, verified_at: str) -> dict:
    authoritative = dashboard_totals(collector, month_key)
    completed = completed_csv_totals(month_key)
    truck_records = truck_record_totals(month_key)
    daily_metrics = daily_metrics_totals(month_key)
    payload = {
        "month": month_key,
        **authoritative,
        "source": "JunkWare Resource > Dashboard > Monthly Year Over Year",
        "source_status": "authoritative",
        "verified_at": verified_at,
        "stored_completed_jobs": completed["jobs"],
        "stored_completed_revenue": completed["revenue"],
        "stored_truck_record_jobs": truck_records["jobs"],
        "stored_truck_record_revenue": truck_records["revenue"],
        "stored_daily_metrics_jobs": daily_metrics["jobs"],
        "stored_daily_metrics_revenue": daily_metrics["revenue"],
        "published_days": max(completed["days"], truck_records["days"], daily_metrics["days"]),
        "unreconciled_completed_jobs": authoritative["completed_jobs"] - daily_metrics["jobs"],
        "unreconciled_gross_revenue": round(authoritative["gross_revenue"] - daily_metrics["revenue"], 2),
        "historical_truck_record_job_delta": authoritative["completed_jobs"] - truck_records["jobs"],
        "historical_truck_record_revenue_delta": round(authoritative["gross_revenue"] - truck_records["revenue"], 2),
    }
    destination = OPSBOT_ROOT / "data" / "history" / "monthly_metrics" / f"monthly_metrics_{month_key}.json"
    atomic_json(destination, payload)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", help="Month to refresh in YYYY-MM format")
    parser.add_argument(
        "--previous-months",
        type=int,
        default=0,
        help="Also refresh this many completed months before the selected month",
    )
    parser.add_argument(
        "--lock-wait-seconds",
        type=int,
        default=0,
        help="Wait this many seconds for another monthly reconciliation to finish",
    )
    args = parser.parse_args()

    current_month = datetime.now(TIMEZONE).strftime("%Y-%m")
    selected_month = args.month or current_month
    if not re.fullmatch(r"\d{4}-\d{2}", selected_month):
        parser.error("--month must use YYYY-MM")
    if args.previous_months < 0 or args.previous_months > 12:
        parser.error("--previous-months must be between 0 and 12")

    lock_handle = LOCK_PATH.open("w")
    lock_deadline = time.monotonic() + max(args.lock_wait_seconds, 0)
    while True:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= lock_deadline:
                print(json.dumps({"status": "skipped", "reason": "reconciliation already running"}))
                return 0
            time.sleep(2)

    sys.path.insert(0, str(OPSBOT_SCRIPTS))
    import collect_junkware_daily as collector

    verified_at = datetime.now(TIMEZONE).isoformat()
    results = []
    try:
        for offset in range(0, -args.previous_months - 1, -1):
            results.append(reconcile_month(collector, month_shift(selected_month, offset), verified_at))
    finally:
        collector.close_browser()

    audit = {
        "status": "completed",
        "verified_at": verified_at,
        "months": results,
    }
    atomic_json(
        OPSBOT_ROOT / "data" / "audits" / "junkware_monthly_reconciliation_latest.json",
        audit,
    )
    print(json.dumps(audit, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
