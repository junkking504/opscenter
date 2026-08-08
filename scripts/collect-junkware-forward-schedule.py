#!/usr/bin/env python3
"""Collect JunkWare schedule-only data across a forward date range.

This reuses one authenticated browser session and writes the same live,
completed, cancellation, and raw appointment files consumed by OpsCenter's
Calendar view. Employee rosters and truck accounting records are intentionally
left to the normal daily collector.
"""

from __future__ import annotations

import argparse
import json
import os
import stat
import sys
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid date: {value}") from exc


def load_collector(opsbot_dir: Path):
    scripts_dir = opsbot_dir / "scripts"
    if not scripts_dir.is_dir():
        raise RuntimeError(f"OpsBot scripts directory not found: {scripts_dir}")
    sys.path.insert(0, str(scripts_dir))
    import collect_junkware_daily as collector  # type: ignore
    import opsbot_paths as paths  # type: ignore

    return collector, paths


def existing_raw(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temp.replace(path)


def isolate_browser_session(collector) -> Path:
    """Reuse the auth cookie while giving this process its own server session."""
    source = Path(collector.STORAGE_STATE_PATH)
    payload = existing_raw(source)
    cookies = payload.get("cookies", [])
    if not isinstance(cookies, list):
        cookies = []
    payload["cookies"] = [
        cookie
        for cookie in cookies
        if str(cookie.get("name", "")) != "ASP.NET_SessionId"
    ]

    fd, temp_name = tempfile.mkstemp(prefix="junkware-storage-", suffix=".json")
    os.close(fd)
    temp_path = Path(temp_name)
    temp_path.write_text(json.dumps(payload), encoding="utf-8")
    temp_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    collector.STORAGE_STATE_PATH = temp_path
    collector._PERSIST_STORAGE_STATE = False
    return temp_path


def publish_schedule_day(collector, paths, target: date) -> dict:
    date_iso = target.isoformat()
    collected = collector.collect_attendance_source(date_iso)
    verification = collected["verification"]
    if not verification.get("all_territories_verified"):
        raise RuntimeError(f"Not every territory was verified for {date_iso}")

    appointment_rows = collected["appointment_rows"]
    cancelled_rows = collected["cancel_rows"]
    live_rows = [
        row
        for row in appointment_rows
        if not (
            str(row.get("appointment_type", "")).strip().lower() == "job"
            and "complete" in str(row.get("job_status", "")).lower()
        )
    ]
    completed_rows = [
        row
        for row in appointment_rows
        if str(row.get("appointment_type", "")).strip().lower() == "job"
        and "complete" in str(row.get("job_status", "")).lower()
    ]

    raw_path = paths.junkware_raw_path(date_iso)
    prior = existing_raw(raw_path)
    collector.write_csv(paths.junkware_live_path(date_iso), live_rows)
    collector.write_csv(paths.junkware_completed_path(date_iso), completed_rows)
    collector.write_attendance_file(
        date_iso,
        collected["all_rows"],
        verification,
        collected["collection_timestamp"],
        require_complete_verification=True,
    )
    write_json_atomic(
        raw_path,
        {
            "date": date_iso,
            "scraped_at": collected["collection_timestamp"],
            "page_url": collected["source_url"],
            "source": "Junkware forward schedule browser scrape",
            "appointments": live_rows,
            "completed": completed_rows,
            "cancelled": cancelled_rows,
            "employees": prior.get("employees", []),
            "truck_records": prior.get("truck_records", []),
            "markets_scraped": verification.get("verified_markets", []),
            "territory_verification": verification.get("territories", []),
        },
    )

    return {
        "date": date_iso,
        "appointments": len(appointment_rows),
        "scheduled": len(live_rows),
        "completed": len(completed_rows),
        "cancelled": len(cancelled_rows),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-date", type=parse_date)
    parser.add_argument("--through-date", type=parse_date)
    parser.add_argument(
        "--dates-file",
        type=Path,
        help="Collect only the ISO dates listed in this file, one per line.",
    )
    parser.add_argument(
        "--minimum-through-date",
        type=parse_date,
        help="Do not apply the empty-day stopping rule before this date.",
    )
    parser.add_argument(
        "--stop-after-empty-days",
        type=int,
        default=0,
        help="Stop after this many consecutive empty days after the minimum date.",
    )
    parser.add_argument(
        "--opsbot-dir",
        type=Path,
        default=Path(os.environ.get("OPSBOT_DIR", Path.home() / ".openclaw" / "workspace" / "opsbot")),
    )
    parser.add_argument(
        "--isolated-session",
        action="store_true",
        help="Use a unique ASP.NET session so multiple collectors can run safely in parallel.",
    )
    parser.add_argument(
        "--report-path",
        type=Path,
        help="Write the collection report here instead of the shared default report.",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Retry a date with a fresh browser after transient network failures.",
    )
    args = parser.parse_args()

    if args.dates_file:
        try:
            targets = sorted({
                parse_date(line.strip())
                for line in args.dates_file.read_text(encoding="utf-8").splitlines()
                if line.strip()
            })
        except OSError as exc:
            parser.error(f"Could not read --dates-file: {exc}")
        if not targets:
            parser.error("--dates-file did not contain any dates")
    else:
        if not args.from_date or not args.through_date:
            parser.error("provide --from-date and --through-date, or --dates-file")
        if args.through_date < args.from_date:
            parser.error("--through-date cannot be earlier than --from-date")
        targets = []
        current = args.from_date
        while current <= args.through_date:
            targets.append(current)
            current += timedelta(days=1)

    requested_start = targets[0]
    requested_end = targets[-1]
    if args.minimum_through_date and args.minimum_through_date > requested_end:
        parser.error("--minimum-through-date cannot be later than --through-date")
    if args.stop_after_empty_days < 0:
        parser.error("--stop-after-empty-days cannot be negative")
    if args.retries < 1:
        parser.error("--retries must be at least 1")

    collector, paths = load_collector(args.opsbot_dir.resolve())
    collector.ensure_history_dirs()
    isolated_storage_path = isolate_browser_session(collector) if args.isolated_session else None
    results: list[dict] = []
    consecutive_empty = 0
    last_appointment_date: str | None = None
    scanned_through = requested_start

    try:
        for current in targets:
            scanned_through = current
            started = datetime.now()
            result = None
            final_error = None
            for attempt in range(1, args.retries + 1):
                try:
                    result = publish_schedule_day(collector, paths, current)
                    break
                except Exception as exc:
                    final_error = exc
                    collector.close_browser()
                    if attempt < args.retries:
                        print(
                            json.dumps({
                                "date": current.isoformat(),
                                "retry": attempt,
                                "error": str(exc),
                            }),
                            file=sys.stderr,
                            flush=True,
                        )
                        time.sleep(attempt * 3)

            if result is not None:
                result["elapsed_seconds"] = round((datetime.now() - started).total_seconds(), 1)
                results.append(result)
                if result["appointments"] or result["cancelled"]:
                    consecutive_empty = 0
                    last_appointment_date = current.isoformat()
                else:
                    consecutive_empty += 1
                print(json.dumps(result), flush=True)
            else:
                failure = {"date": current.isoformat(), "error": str(final_error)}
                results.append(failure)
                consecutive_empty = 0
                print(json.dumps(failure), file=sys.stderr, flush=True)

            minimum_reached = not args.minimum_through_date or current >= args.minimum_through_date
            if (
                minimum_reached
                and args.stop_after_empty_days
                and consecutive_empty >= args.stop_after_empty_days
            ):
                break
    finally:
        collector.close_browser()
        if isolated_storage_path:
            isolated_storage_path.unlink(missing_ok=True)

    summary = {
        "started_at": requested_start.isoformat(),
        "scanned_through": scanned_through.isoformat(),
        "requested_through": requested_end.isoformat(),
        "last_appointment_date": last_appointment_date,
        "consecutive_empty_days": consecutive_empty,
        "successful_days": sum("error" not in item for item in results),
        "failed_days": sum("error" in item for item in results),
        "appointment_rows": sum(int(item.get("appointments", 0)) for item in results),
        "results": results,
    }
    report_path = args.report_path or (paths.JUNKWARE_HISTORY_DIR / "forward_schedule_collection.json")
    write_json_atomic(report_path, summary)
    print(json.dumps({key: value for key, value in summary.items() if key != "results"}, indent=2))
    return 1 if summary["failed_days"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
