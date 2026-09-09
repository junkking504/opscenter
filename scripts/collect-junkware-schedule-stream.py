#!/usr/bin/env python3
"""Continuously publish verified JunkWare schedule markets from one browser.

The authoritative OpsBot collector establishes the requested schedule date and
all-market baseline once. Subsequent sweeps keep that page open, switch markets
inside the same authenticated session, and publish each market immediately.
"""

import argparse
import importlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlparse, parse_qs


MARKETS = [
    ("352", "Junk King New Orleans"),
    ("477", "Junk King Northshore"),
    ("399", "Junk King Baton Rouge"),
    ("484", "Junk King Jefferson Parish"),
]
TIMEZONE = ZoneInfo("America/Chicago")


def charge_signature(row):
    return [str(row.get(key, "")) for key in ("truck", "appointment_type", "job_status", "revenue", "tip")]


def enrich_closed_charges(collector, data_dir, date_iso, market_id, rows, *, read_limit=1):
    """Read changed completed charges without navigating the schedule tab.

    At most one eight-second detail read per market sweep. Reuse only matching source
    identities/signatures, and recheck unchanged charges every five minutes.
    Failure leaves the schedule available and the charge visibly pending.
    Initialization uses read_limit=0 to retain matching verified details locally.
    """
    try:
        previous = json.loads(snapshot_file(data_dir, market_id, date_iso).read_text())
        cached = {str(row.get("appt_id")): row for row in previous.get("appointments", [])} if previous.get("date") == date_iso else {}
    except (OSError, ValueError, TypeError):
        cached = {}
    reads = 0
    ordered = sorted(rows, key=lambda row: str(cached.get(str(row.get("appt_id")), {}).get("closeout_attempted_at", cached.get(str(row.get("appt_id")), {}).get("closeout_verified_at", ""))))
    for row in ordered:
        if not re.match(r"^(completed|closed)\b", str(row.get("job_status", "")), re.I):
            continue
        identity = str(row.get("appt_id", ""))
        if not re.fullmatch(r"\d{1,12}", identity):
            continue
        old = cached.get(identity, {})
        stamp = str(old.get("closeout_verified_at", ""))
        try:
            age = time.time() - datetime.fromisoformat(stamp).timestamp()
        except ValueError:
            age = float("inf")
        matching = old.get("closeout_signature") == charge_signature(row)
        if matching and age >= 0 and isinstance(old.get("closeout"), dict):
            for key in ("closeout", "closeout_verified_at", "closeout_signature", "closeout_attempted_at"):
                if key in old:
                    row[key] = old[key]
            if age < 300:
                continue
        row["closeout_refresh_pending"] = True
        row["closeout_attempted_at"] = old.get("closeout_attempted_at", "")
        if reads >= read_limit:
            continue
        reads += 1
        row["closeout_attempted_at"] = datetime.now(TIMEZONE).isoformat()
        schedule_page = collector.page
        detail_page = None
        try:
            detail_page = schedule_page.context.new_page()
            collector.page = detail_page
            detail_page.goto(f"https://junkware.junk-king.com/franchise/appointment.aspx?id={identity}", wait_until="domcontentloaded", timeout=8000)
            detail = collector.evaluate(collector._JS_APPT_DETAILS)
            source = urlparse(str(detail.get("url", "")))
            source_date = str(detail.get("appointmentDate", ""))
            parsed_date = next((datetime.strptime(source_date, fmt).date().isoformat() for fmt in ("%m/%d/%Y", "%Y-%m-%d") if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}" if fmt.startswith("%m") else r"\d{4}-\d{2}-\d{2}", source_date)), "")
            truck = collector.evaluate("() => document.getElementById('ctl00_Content_TruckDD')?.selectedOptions[0]?.textContent?.trim() || ''")
            if source.hostname != "junkware.junk-king.com" or parse_qs(source.query).get("id") != [identity] or parsed_date != date_iso:
                raise ValueError("Charge detail identity/date did not verify")
            if not re.match(r"^(completed|closed)\b", str(detail.get("finalStatus", "")), re.I) or str(detail.get("finalAppointmentType", "")).lower() != str(row.get("appointment_type", "")).lower() or truck != row.get("truck"):
                raise ValueError("Charge detail changed during schedule collection")
            if not isinstance(detail.get("closeout"), dict) or not detail["closeout"].get("total"):
                raise ValueError("Charge detail was incomplete")
            row.update(closeout=detail["closeout"], closeout_verified_at=datetime.now(TIMEZONE).isoformat(), closeout_signature=charge_signature(row), closeout_refresh_pending=False)
        except Exception as exc:
            reason = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
            print(f"JunkWare charge detail {identity} pending: {reason}", file=sys.stderr, flush=True)
        finally:
            collector.page = schedule_page
            if detail_page is not None:
                detail_page.close()
    return rows


def appointment_rows(collector, data, market_name, source_url):
    rows = []
    for raw in data.get("appts", []):
        if not isinstance(raw, dict):
            continue
        row = collector.normalize_appt(raw)
        row["market"] = market_name
        territory = collector.classify_territory(
            market_name,
            row.get("address", ""),
            city=row.get("city"),
            zip_code=row.get("zip"),
        )
        row["source_territory"] = territory.source_territory
        row["territory"] = territory.normalized_territory
        row["normalized_territory"] = territory.normalized_territory
        row["parish"] = territory.parish
        row["classification_source"] = "junkware_schedule"
        row["classification_confidence"] = "confirmed"
        row["source_page"] = str(data.get("url", "") or source_url)
        rows.append(row)
    return rows


def cancellation_rows(data, market_name, source_url):
    rows = []
    for raw in data.get("cancels", []):
        if not isinstance(raw, dict):
            continue
        cancelled_by = str(raw.get("cancelled_by", "") or "").strip()
        rows.append({
            "job_id": str(raw.get("jk_num", "") or "").strip(),
            "appt_id": str(raw.get("appt_id", "") or "").strip(),
            "appointment_time": str(raw.get("appointment_time", "") or raw.get("time", "") or raw.get("start_time", "") or ""),
            "customer_name": str(raw.get("info", "") or "").strip(),
            "phone": "",
            "address": "",
            "market": market_name,
            "truck": "",
            "revenue": "",
            "tip": "",
            "payment_type": "",
            "labor_hours": "",
            "job_status": f"Cancelled by {cancelled_by}" if cancelled_by else "Cancelled",
            "appointment_type": str(raw.get("type", "") or "").strip(),
            "cancellation_status": "cancelled",
            "cancellation_reason": str(raw.get("info", "") or "").strip(),
            "cancelled_by": cancelled_by,
            "source_page": str(data.get("url", "") or source_url),
        })
    return rows


def collect_selected_market(collector, date_iso, market_id, market_name):
    last_warning = ""
    for attempt in range(1, 4):
        result = collector.evaluate(collector._js_switch_market(market_id))
        if not isinstance(result, dict):
            last_warning = "invalid market-switch response"
            continue
        if result.get("error"):
            last_warning = str(result.get("error"))
            break

        collector.submit_aspnet_form("ctl00$Content$SelectServiceProvidersBtn", "")
        try:
            collector.page.wait_for_function(
                """
                target => {
                  const select = document.getElementById("ctl00_Content_ServiceProviderGroupLB") ||
                    document.querySelector('select[name="ctl00$Content$ServiceProviderGroupLB"]');
                  return select && String(select.value) === String(target);
                }
                """,
                arg=str(market_id),
                timeout=20000,
            )
            collector.wait_for_page_ready()
        except collector.PlaywrightTimeoutError:
            last_warning = f"territory confirmation timed out (attempt {attempt})"
            continue

        deadline = time.time() + 35
        confirmed_at = None
        last_signature = None
        stable_since = None
        accepted = None
        while time.time() < deadline:
            try:
                candidate = collector.evaluate(collector._JS_EXTRACT)
            except Exception as exc:
                last_warning = str(exc)
                collector.page.wait_for_timeout(1000)
                continue
            if not isinstance(candidate, dict):
                collector.page.wait_for_timeout(1000)
                continue
            if str(candidate.get("market", "")).strip() != str(market_id):
                last_warning = "page did not confirm the requested market"
                collector.page.wait_for_timeout(1000)
                continue
            if str(candidate.get("scheduleDate", "")).strip() != date_iso:
                raise RuntimeError("JunkWare schedule date changed during the live sweep.")
            if confirmed_at is None:
                confirmed_at = time.time()
            appts = candidate.get("appts", [])
            cancels = candidate.get("cancels", [])
            signature = (
                len(appts) if isinstance(appts, list) else -1,
                len(cancels) if isinstance(cancels, list) else -1,
                str(candidate.get("url", "")),
            )
            if signature != last_signature:
                last_signature = signature
                stable_since = time.time()
            accepted = candidate
            if stable_since is not None and time.time() - stable_since >= 3:
                break
            if confirmed_at is not None and time.time() - confirmed_at >= 8 and signature[:2] == (0, 0):
                break
            collector.page.wait_for_timeout(1000)
        if isinstance(accepted, dict):
            return accepted
    raise RuntimeError(f"{market_name} ({market_id}) was not verified: {last_warning or 'unknown failure'}")


def snapshot_file(data_dir, market_id, date_iso):
    return data_dir / "history" / "junkware" / "schedule-watchers" / market_id / f"junkware_schedule_fast_{date_iso}.json"


def write_snapshot(data_dir, date_iso, market_id, market_name, appointments, cancelled, source_url):
    target = snapshot_file(data_dir, market_id, date_iso)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps({
        "date": date_iso,
        "scraped_at": datetime.now(TIMEZONE).isoformat(),
        "page_url": source_url,
        "source": "JunkWare verified persistent schedule stream",
        "appointments": appointments,
        "cancelled": cancelled,
        "markets_scraped": [market_name],
        "territory_verification": [{
            "territory_id": market_id,
            "territory": market_name,
            "verified": True,
            "reason": "requested date and territory confirmed",
        }],
    }, indent=2), encoding="utf-8")
    temporary.replace(target)
    return target


def publish_snapshot(opscenter_dir, data_dir, date_iso, market_id, target):
    environment = os.environ.copy()
    environment["OPSCENTER_DATA_DIR"] = str(data_dir)
    subprocess.run([
        str(opscenter_dir / "node_modules" / ".bin" / "tsx"),
        "scripts/publish-junkware-schedule-changes.ts",
        "--data-dir", str(data_dir),
        "--date", date_iso,
        "--snapshot-file", str(target),
        "--scope", f"market-{market_id}",
    ], cwd=opscenter_dir, env=environment, check=True)


def publish_market(collector, opscenter_dir, data_dir, date_iso, market_id, market_name, data):
    source_url = str(data.get("url", "") or collector.SCHEDULE_URL)
    appointments = appointment_rows(collector, data, market_name, source_url)
    appointments = enrich_closed_charges(collector, data_dir, date_iso, market_id, appointments)
    cancelled = cancellation_rows(data, market_name, source_url)
    target = write_snapshot(data_dir, date_iso, market_id, market_name, appointments, cancelled, source_url)
    publish_snapshot(opscenter_dir, data_dir, date_iso, market_id, target)
    print(
        f"JunkWare live market {market_name} ({market_id}): "
        f"{len(appointments)} appointment(s), {len(cancelled)} cancellation(s)",
        file=sys.stderr,
        flush=True,
    )


def write_health(data_dir, started_at, started_epoch, market_durations):
    target = data_dir / "slack" / "junkware_schedule_watchers" / "detector.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps({
        "status": "ok",
        "started_at": started_at,
        "completed_at": datetime.now(TIMEZONE).isoformat(),
        "duration_seconds": round(time.time() - started_epoch, 1),
        "market_durations_seconds": market_durations,
        "exit_code": 0,
    }) + "\n", encoding="utf-8")
    temporary.replace(target)


def initialize(collector, opscenter_dir, data_dir, date_iso):
    source_url, appointments, cancelled, verification = collector.collect_all_markets(date_iso)
    if verification.get("verified_date") != date_iso or not verification.get("all_territories_verified"):
        raise RuntimeError("Initial JunkWare schedule stream baseline did not verify every market.")
    for market_id, market_name in MARKETS:
        market_appointments = [row for row in appointments if str(row.get("market", "")) == market_name]
        market_cancelled = [row for row in cancelled if str(row.get("market", "")) == market_name]
        # A schedule baseline has no charge detail. Preserve matching verified
        # closeouts before replacing the files that hold the detail cache.
        market_appointments = enrich_closed_charges(collector, data_dir, date_iso, market_id, market_appointments, read_limit=0)
        target = write_snapshot(data_dir, date_iso, market_id, market_name, market_appointments, market_cancelled, source_url)
        publish_snapshot(opscenter_dir, data_dir, date_iso, market_id, target)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--opscenter-dir", required=True)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--watch-interval", type=float, default=5.0)
    args = parser.parse_args()

    opsbot_dir = Path(os.environ.get("OPSBOT_DIR", "/Users/missioncontrol/.openclaw/workspace/opsbot"))
    scripts_dir = opsbot_dir / "scripts"
    data_dir = Path(args.data_dir).resolve()
    opscenter_dir = Path(args.opscenter_dir).resolve()
    if not (scripts_dir / "collect_junkware_daily.py").is_file():
        raise RuntimeError("The authoritative OpsBot JunkWare collector is unavailable.")
    sys.path.insert(0, str(scripts_dir))
    collector = importlib.import_module("collect_junkware_daily")
    collector._PERSIST_STORAGE_STATE = False

    date_iso = args.date or datetime.now(TIMEZONE).date().isoformat()
    try:
        initial_started_at = datetime.now(TIMEZONE).isoformat()
        initial_started_epoch = time.time()
        initialize(collector, opscenter_dir, data_dir, date_iso)
        write_health(data_dir, initial_started_at, initial_started_epoch, {"initialization": round(time.time() - initial_started_epoch, 1)})
        if args.once:
            return

        while True:
            time.sleep(max(1.0, args.watch_interval))
            current_date = args.date or datetime.now(TIMEZONE).date().isoformat()
            if current_date != date_iso:
                collector.close_browser()
                date_iso = current_date
                initialize(collector, opscenter_dir, data_dir, date_iso)

            started_at = datetime.now(TIMEZONE).isoformat()
            started_epoch = time.time()
            durations = {}
            for market_id, market_name in MARKETS:
                market_started = time.time()
                data = collect_selected_market(collector, date_iso, market_id, market_name)
                publish_market(collector, opscenter_dir, data_dir, date_iso, market_id, market_name, data)
                durations[market_id] = round(time.time() - market_started, 1)
            write_health(data_dir, started_at, started_epoch, durations)
    finally:
        collector.close_browser()


if __name__ == "__main__":
    main()
