"""Opt-in capture with durable gaps. Source publication always wins over push.
No network, credentials or delivery timers. Only selected fact hashes are retained.
"""
from __future__ import annotations
import fcntl
import hashlib
import json
import os
import stat
import re
import sys
import time
import uuid
from zoneinfo import ZoneInfo
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from decimal import Decimal
from urllib.parse import urlparse, urljoin

MAX_ENTRIES = 10000
MAX_BYTES = 128 * 1024 * 1024
MARKETS = {"352": "New Orleans", "477": "Northshore", "399": "Baton Rouge", "484": "Jefferson Parish"}
# Exact producer labels plus the existing short-label contract. No fuzzy name
# matching or fallback from an explicitly unknown market to a geographic territory.
MARKET_IDS = {label: market for market, name in MARKETS.items() for label in (name, f"Junk King {name}")}


def schedule_market(row):
    return MARKET_IDS.get(first(row, "market", "territory"))


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        sync_dir(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def retained_size(entries):
    size = 0
    for item in entries:
        try:
            size += item.stat().st_size
        except FileNotFoundError:
            # Consumer may archive an acknowledged entry while the writer counts.
            pass
    return size


def stamp(value):
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if result.tzinfo is None or result > datetime.now(timezone.utc):
        raise ValueError("invalid_observation_time")
    return result.isoformat()


def first(row, *keys):
    return next((str(row[key]).strip() for key in keys if row.get(key) not in (None, "")), "")


def truck_notification_title(value):
    # LinxUp supplies labels such as "Truck# 9" as well as bare numbers.
    # Normalize display only: source facts and event hashes stay unchanged.
    number = re.sub(r"^(?:(?:truck(?=\s|#|[0-9]|$)|#)\s*)+", "", str(value).strip(), flags=re.IGNORECASE)
    return f"Truck #{number[:20]}"


def observation(identity, revision):
    return {"identity": digest(identity), "revision": digest(revision)}


def completed_status(value):
    return bool(re.match(r"^(completed|closed)\b", str(value).strip(), re.IGNORECASE))


def price_text(value):
    value = str(value).strip()
    if len(value) > 40 or not re.fullmatch(r"\$?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?", value):
        return ""
    return f"${Decimal(value.replace('$', '').replace(',', '')):,.2f}"


def related_snapshot(path, day, kind):
    """Bounded reads of already-collected local evidence. No refresh or network."""
    history = next((parent for parent in path.parents if parent.name == "history"), None)
    if history is None:
        return None
    target = (history / "linxup" / "appointment_visits" / f"linxup_appointment_visits_{day}.json"
              if kind == "visits" else history / "junkware" / f"junkware_{day}_raw.json")
    try:
        if target.is_symlink():
            return None
        with target.open('rb') as source:
            raw = source.read(8 * 1024 * 1024 + 1)
        if len(raw) > 8 * 1024 * 1024:
            return None
        payload = json.loads(raw)
        at = stamp(payload.get("collection_timestamp") if kind == "visits" else payload.get("scraped_at"))
        if payload.get("date") != day or (datetime.now(timezone.utc) - datetime.fromisoformat(at)).total_seconds() > 900:
            return None
        return payload
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def truck_key(value):
    label = truck_notification_title(value).removeprefix("Truck #")
    return str(int(label)) if re.fullmatch(r"[0-9]{1,8}", label) else ""


def confirmed_intervals(row, visits, day, observed_at):
    """Existing GPS evidence for display; never derives an event or duration."""
    identity = first(row, "appt_id", "appointment_id")
    reference = first(row, "job_id").upper()
    truck = truck_key(first(row, "truck", "truck_number", "assigned_truck"))
    if not identity or not truck or not re.fullmatch(r"JK[0-9]+", reference):
        return []
    candidates = {}
    excluded = ("operational_confirmation", "conflict", "superseded_at", "supersededAt", "departure_bounds", "departureBounds")
    for visit in visits:
        if not isinstance(visit, dict) or first(visit, "appointment_id", "appt_id") != identity:
            continue
        if visit.get("match_confidence") != "confirmed" or visit.get("pass_by_only") or truck_key(first(visit, "truck_number", "truck")) != truck:
            continue
        if first(visit, "jk_number", "job_id").upper() != reference or any(visit.get(key) for key in excluded):
            return []
        records = visit.get("visit_intervals")
        if not records:
            records = [{"arrival":visit.get("first_arrival"), "departure":visit.get("final_departure"), "onsite_minutes":visit.get("onsite_minutes")} ] if visit.get("visit_count") == 1 else []
        if not isinstance(records, list):
            return []
        for interval in records:
            try:
                if any(interval.get(key) for key in excluded):
                    return []
                start = stamp(interval.get("arrival"))
                local = datetime.fromisoformat(start).astimezone(ZoneInfo("America/Chicago"))
                if local.date().isoformat() != day or datetime.fromisoformat(start) > datetime.fromisoformat(observed_at):
                    return []
                end = stamp(interval["departure"]) if interval.get("departure") and interval.get("departure_confirmed") is not False else ""
                if end and not datetime.fromisoformat(start) < datetime.fromisoformat(end) <= datetime.fromisoformat(observed_at):
                    return []
                minutes = interval.get("onsite_minutes")
                duration = f"{minutes:.1f} min" if end and type(minutes) in (int, float) and 0 <= minutes < 1440 else ""
                old = candidates.get(start)
                if old and old["departure"] and end and old["departure"] != end:
                    return []
                # A confirmed closure replaces the stale open copy of that visit.
                if not old or end:
                    if old and old["departure"] and old["duration"] != duration:
                        duration = ""
                    candidates[start] = {"arrival":start, "departure":end, "duration":duration}
            except (ValueError, TypeError, AttributeError):
                return []
    intervals = sorted(candidates.values(), key=lambda value:value["arrival"])
    if any(not left["departure"] or datetime.fromisoformat(left["departure"]) > datetime.fromisoformat(right["arrival"]) for left, right in zip(intervals, intervals[1:])):
        return []  # Overlapping/revised starts cannot prove distinct visits.
    return intervals


def visit_clock(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(ZoneInfo("America/Chicago")).strftime("%I:%M %p").lstrip("0") if value else "Not verified"


def photo_count(row):
    photos = row.get("photos")
    if not isinstance(photos, list) or row.get("detail_collection_error"):
        return None
    urls = set()
    for item in photos:
        value = item if isinstance(item, str) else first(item, "url", "src", "href") if isinstance(item, dict) else ""
        try:
            url = urlparse(urljoin("https://junkware.junk-king.com/franchise/appointment.aspx", value))
            if url.scheme == "https" and url.hostname == "junkware.junk-king.com" and url.path.startswith("/system/aspnet/local/media/") and re.search(r"\.(jpe?g|png|webp)$", url.path, re.I):
                urls.add(url._replace(fragment="").geturl())
        except ValueError:
            continue
    return len(urls)


def completion_details(row, intervals=()):
    """Selected source display only. Never infer load units or payment receipt."""
    closeout = row.get("closeout")
    if not isinstance(closeout, dict) or row.get("detail_collection_error") or row.get("closeout_refresh_pending"):
        closeout = {}
    signature = row.get("closeout_signature")
    if signature is not None and signature != [str(row.get(key, "")) for key in ("truck", "appointment_type", "job_status", "revenue", "tip")]:
        closeout = {}

    def load(size, quantity, unit="load"):
        provided = size is not None
        size = str(size or "").strip()[:100]
        parenthetical = re.search(r"\(([^)]+)\)", size)
        size = parenthetical.group(1).strip() if parenthetical and size.casefold() != "bag(s)" else size
        quantity = str(quantity or "").strip()
        if quantity and (len(quantity) > 8 or not re.fullmatch(r"[0-9]+", quantity)):
            return ""
        count = int(quantity or 0)
        if size.casefold() == "dry run":
            return "Dry Run"
        if size.casefold() in ("bag(s)", "bags", "bag"):
            return f"{count} bag{'s' if count != 1 else ''}" if count else "Bags (quantity not verified)"
        # Hidden numeric option values carry no verified unit/fraction label.
        if not provided or re.fullmatch(r"[0-9.]+", size) or size.casefold() in ("none", "select", "unassigned"):
            return ""
        full = f"{count} full {unit}{'s' if count != 1 else ''}" if count else ""
        partial = size + (" " + unit if re.fullmatch(r"[0-9]+/[0-9]+", size) else "")
        return " + ".join(part for part in (full, partial) if part)

    loads = []
    for key, label in (("load", ""), ("bedload", "Bedload: ")):
        value = load(closeout.get(key + "Size"), closeout.get(key + "Quantity"), "bedload" if key == "bedload" else "load")
        if value:
            loads.append(label + value)
    price, detail_price = price_text(first(row, "revenue")), price_text(closeout.get("total", ""))
    # Conflicting page/detail totals are not a verified single price.
    price = "" if price and detail_price and price != detail_price else price or detail_price
    methods = {"billed": "Billed", "cash": "Cash", "check": "Check", "credit card": "Credit Card",
               "debit card": "Debit Card", "ach": "ACH", "wire": "Wire", "bank transfer": "Bank Transfer"}
    payments = closeout.get("payments")
    if isinstance(payments, list) and payments:
        names = [methods.get(first(payment, "method").casefold(), "") if isinstance(payment, dict) else "" for payment in payments]
        payment = ("Billed" if "Billed" in names else " + ".join(dict.fromkeys(names))) if all(names) else ""
    else:
        payment = methods.get(first(row, "payment_type").casefold(), "")
    result = {"load": " + ".join(loads), "price": price, "payment": payment}
    if first(row, "appointment_type").casefold() == "estimate":
        prices = [price_text(closeout[key]) for key in ("loadPrice", "bedloadPrice") if closeout.get(key) not in (None, "")]
        load_price = f"${sum(Decimal(value.replace('$', '').replace(',', '')) for value in prices):,.2f}" if prices and all(prices) else ""
        load_size = " + ".join(loads).removesuffix(" load")
        result["estimateLoad"] = f"{load_price or 'Not verified'} ({load_size or 'size not verified'})"
        charges = closeout.get("otherCharges")
        labor = Decimal(0)
        extra_charges = []
        valid = isinstance(charges, list)
        if valid:
            for charge in charges:
                if not isinstance(charge, dict):
                    valid = False; break
                name = first(charge, "name", "label", "description")
                if not name:
                    valid = False; break
                if re.search(r"\blabor\b", name, re.I):
                    amount = price_text(charge.get("total"))
                    if not amount:
                        valid = False; break
                    labor += Decimal(amount.replace('$', '').replace(',', ''))
                else:
                    amount = price_text(charge.get("total"))
                    if amount != "$0.00":
                        extra_charges.append(f"{name[:80]}: {amount or 'Not verified'}")
        discount = price_text(closeout.get("discount", ""))
        if discount and discount != "$0.00":
            extra_charges.append(f"Discount: {discount}")
        result["charges"] = extra_charges
        result["labor"] = f"${labor:,.2f}" if valid else ""
        result["arrival"] = visit_clock(intervals[0]["arrival"]) if intervals else "Not verified"
        result["departure"] = visit_clock(intervals[-1]["departure"]) if intervals and all(v["departure"] for v in intervals) else "Not verified"
        count = photo_count(row)
        result["photos"] = f"{count} available in OpsCenter" if count else "None recorded" if count == 0 else "Not verified"
    return result


def clock_label(value):
    for pattern in ("%I:%M %p", "%H:%M"):
        try:
            return datetime.strptime(value.strip(), pattern).strftime("%I:%M %p").lstrip("0")
        except ValueError:
            continue
    return value[:100]


def clock_out_pay(payload, row, day, value):
    """Use the same published record, never a second read or a guessed total."""
    payroll = payload.get("source_freshness", {}).get("metrics", {}).get("payroll", {})
    ready = payroll.get("status") == "current" and row.get("pay_is_final") is True
    try:
        clock = datetime.strptime(clock_label(value), "%I:%M %p").time()
        out = datetime.combine(date.fromisoformat(day), clock, ZoneInfo("America/Chicago"))
        sources = [stamp(payroll.get("as_of")), stamp(row.get("payroll_as_of")), stamp(payload.get("payroll_as_of"))]
        ready = ready and all(datetime.fromisoformat(at) >= out for at in sources)
    except (ValueError, TypeError):
        ready = False
    fields = [("Total pay", "employee_total_earnings" if "employee_total_earnings" in row else "total_pay"),
              ("Hourly pay", "hourly_pay"), ("Tips", "tip"), ("Bonuses", "total_bonus")]
    amounts = {label: price_text(row.get(key)) if ready else "" for label, key in fields}
    supplemental = price_text(row.get("supplemental_daily_pay")) if ready else ""
    # Do not repair inconsistent source totals by calculating a replacement.
    if ready and all(amounts.values()) and supplemental:
        number = lambda text: Decimal(text.replace('$', '').replace(',', ''))
        expected = sum(number(amounts[label]) for label in ("Hourly pay", "Tips", "Bonuses")) + number(supplemental)
        if abs(number(amounts["Total pay"]) - expected) > Decimal("0.01"):
            amounts["Total pay"] = ""
    if row.get("is_salary") is True:
        # These daily metrics exclude base salary; do not call extra pay total pay.
        amounts["Total pay"] = ""
        amounts["Hourly pay"] = "Not applicable"
    lines = [f"{label}: {amounts[label] or 'Not verified'}" for label, _ in fields]
    if supplemental and supplemental != "$0.00":
        lines.append(f"Supplemental pay: {supplemental}")
    return lines


def project(path, payload):
    """Strict producer contracts; unsupported/missing evidence yields no coverage."""
    day = str(payload.get("date", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return []
    parsed = date.fromisoformat(day)
    today = datetime.now(ZoneInfo("America/Chicago")).date()
    # Old backfills and distant forecasts are outside live push coverage.
    if not today - timedelta(days=14) <= parsed <= today + timedelta(days=90):
        return []
    batches = []
    def batch(scope, category, at, observations, complete=True):
        if len(observations) > 10000:
            raise ValueError("push_observation_capacity")
        identities = [row["identity"] for row in observations]
        if len(set(identities)) != len(identities):
            raise ValueError("duplicate_source_identity")
        batches.append({"scope": scope, "category": category, "observedAt": stamp(at),
                        "complete": complete, "observations": sorted(observations, key=lambda row: row["identity"])})
    if path.name in (f"junkware_schedule_fast_{day}.json", f"junkware_{day}_raw.json", f"junkware_schedule_requested_{day}.json") and isinstance(payload.get("appointments"), list):
        verification = payload.get("territory_verification")
        if not isinstance(verification, list):
            return []
        related = related_snapshot(path, day, "visits")
        visits = related.get("visits", []) if related and isinstance(related.get("visits"), list) else []
        rows = payload["appointments"] + payload.get("completed", []) + payload.get("cancelled", [])
        for verified in verification:
            market = str(verified.get("territory_id", ""))
            if verified.get("verified") is not True or market not in MARKETS:
                continue
            selected = [row for row in rows if schedule_market(row) == market]
            # Never interpret an unclassified row as a complete-market removal.
            if any(schedule_market(row) is None for row in rows):
                continue
            identity_counts = {}
            for candidate in selected:
                candidate_id = first(candidate, "appt_id", "appointment_id")
                identity_counts[candidate_id] = identity_counts.get(candidate_id, 0) + 1
            items_by_id = {}
            for row in selected:
                identity = first(row, "appt_id", "appointment_id")
                if not identity:
                    raise ValueError("schedule_identity_missing")
                facts = {
                    "status": first(row, "job_status", "status").casefold(),
                    "type": first(row, "appointment_type").casefold(),
                    "truck": first(row, "truck", "truck_number", "assigned_truck"),
                    "time": first(row, "appointment_time", "schedule_time", "time", "start_time"),
                    "end": first(row, "end_time"),
                }
                if row in payload.get("cancelled", []):
                    facts["status"] = "cancelled"
                # normalize_appt supplies empty crew placeholders in page-only
                # rows. Only verified detail evidence owns assignment fields;
                # missing detail evidence must never clear a prior assignment.
                if row.get("crew_assignment_status") == "verified" and not row.get("detail_collection_error"):
                    for field, aliases in (("driver", ("driver_name", "driver")), ("navigator", ("navigator_name", "navigator"))):
                        if any(key in row for key in aliases):
                            facts[field] = first(row, *aliases).casefold()
                    if "additional_crew" in row:
                        facts["crew"] = row["additional_crew"]
                    elif "crew" in row:
                        facts["crew"] = row["crew"]
                item = observation(identity, facts)
                item["facts"] = {key: digest(value) for key, value in facts.items()}
                job_id = first(row, "job_id")
                display_id = job_id if re.fullmatch(r"JK[0-9]+", job_id, re.IGNORECASE) else identity
                customer = first(row, "customer_name", "customer", "client_name")[:80]
                item["display"] = {
                    "label": display_id[:80] + (" — " + customer if customer else ""),
                    "address": first(row, "address")[:200], "phone": first(row, "phone")[:40],
                    "amount": first(row, "revenue")[:40] if facts.get("type", "").casefold() != "estimate" else "",
                    "completion": completion_details(row, confirmed_intervals(row, visits, day, stamp(payload.get("scraped_at"))) if identity_counts[identity] == 1 else ()) if completed_status(facts["status"]) else {},
                    "fields": {key: ((", ".join(str(part) for part in value) if isinstance(value, list)
                                      else str(value).title() if key in ("status", "type") else str(value))[:100])
                               for key, value in facts.items()},
                }
                items_by_id[identity] = item
            items = list(items_by_id.values())
            batch(f"schedule:{day}:market-{market}", "schedule", payload.get("scraped_at"), items)
    elif path.name == f"daily_metrics_{day}.json":
        source = payload.get("source_freshness", {}).get("sources", {}).get("junkware_employees", {})
        if source.get("status") != "current" or not isinstance(payload.get("payroll_records"), list):
            return []
        items = []
        for row in payload["payroll_records"]:
            name = first(row, "employee_id", "name", "employee", "employee_name", "crew_member").casefold()
            if not name:
                raise ValueError("krewe_identity_missing")
            if "," in name:
                last, given = (part.strip() for part in name.split(",", 1))
                name = f"{given} {last}" if last != given else given
            name = " ".join(name.split())
            for kind, keys in (("in", ("clock_in", "time_in", "clockIn", "timeIn")), ("out", ("clock_out", "time_out", "clockOut", "timeOut"))):
                value = first(row, *keys)
                if value:
                    item = observation([name, kind], value)
                    display_name = first(row, "name", "employee_name", "employee", "crew_member", "employee_id")[:100] or name[:100]
                    lines = [f"{display_name} clocked {'in' if kind == 'in' else 'out'}: {clock_label(value)}"]
                    if kind == "out":
                        lines += clock_out_pay(payload, row, day, value)
                    item["notification"] = {"title": "Krewe", "body": "\n".join(lines)}
                    items.append(item)
        batch(f"krewe:{day}", "krewe", source.get("as_of"), items)
    elif path.name == f"linxup_alerts_{day}.json" and path.parent.name != "raw":
        if payload.get("pagination_completed") is not True or payload.get("validation_status") != "passed" or payload.get("collection_errors") or not isinstance(payload.get("alerts"), list):
            return []
        items = []
        for row in payload["alerts"]:
            kind = first(row, "alert_type_normalized", "alert_type").lower()
            if kind not in ("geofence_entered", "geofence_exited"):
                continue
            if not row.get("alert_id") or not row.get("truck_number") or not row.get("geofence_name"):
                return []
            stamp(row.get("occurred_at"))
            item = observation(row["alert_id"], {key: row.get(key) for key in ("alert_type_normalized", "alert_type", "truck_number", "geofence_name", "occurred_at", "duration_seconds")})
            occurred = datetime.fromisoformat(row["occurred_at"].replace("Z", "+00:00")).astimezone(ZoneInfo("America/Chicago"))
            at = occurred.strftime("%I:%M %p").lstrip("0")
            action = "Arrived" if kind == "geofence_entered" else "Departed"
            item["notification"] = {"title": truck_notification_title(row["truck_number"]),
                                    "body": f"{action}{' at' if kind == 'geofence_entered' else ''} {str(row['geofence_name'])[:150]}: {at}\nDate: {occurred.date().isoformat()} (Central)"}
            items.append(item)
        batch(f"fleet:{day}", "fleet", payload.get("collection_timestamp"), items)
    return batches


GAP_CODES = {"capture_failure", "contract_violation", "capture_capacity", "lock_busy", "recovery_uncertain", "writer_conflict", "source_reordered", "capture_disabled", "helper_version_mismatch", "ordering_uncertain", "gap_capacity", "scope_retired"}


def source_scopes(path, payload):
    day = str(payload.get("date", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return []
    today = datetime.now(ZoneInfo("America/Chicago")).date()
    parsed = date.fromisoformat(day)
    if not today - timedelta(days=14) <= parsed <= today + timedelta(days=90):
        return []
    if path.name in (f"junkware_schedule_fast_{day}.json", f"junkware_{day}_raw.json", f"junkware_schedule_requested_{day}.json"):
        return [f"schedule:{day}:market-{market}" for market in MARKETS]
    if path.name == f"daily_metrics_{day}.json":
        return [f"krewe:{day}"]
    if path.name == f"linxup_alerts_{day}.json" and path.parent.name != "raw":
        return [f"fleet:{day}"]
    return []


def gap_file(root, scope):
    return root / "gaps" / (hashlib.sha256(scope.encode()).hexdigest() + ".json")


def mark_gap(root, scopes, code, reset=True):
    """One sticky, bounded marker per known scope; no source content/errors."""
    code = code if code in GAP_CODES else "capture_failure"
    scopes = scopes or ["journal:global"]
    directory = root / "gaps"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    for scope in scopes:
        target = gap_file(root, scope)
        if not reset and target.exists():
            previous = json.loads(target.read_text())
            if previous.get("code") == code and not previous.get("reset"):
                continue
        if not target.exists() and len(list(directory.glob("*.json"))) >= 1000:
            # Capacity is a diagnostic, never a reset of unrelated sources.
            scope = "journal:capacity"
            target = gap_file(root, scope)
            code, reset = "gap_capacity", False
        previous = json.loads(target.read_text()) if target.exists() else {}
        marker_id = uuid.uuid4().hex
        reset_id = marker_id if reset else previous.get("resetId", previous.get("id") if previous.get("reset", True) else None)
        save(target, encoded({"scope": scope, "id": marker_id, "code": code,
                              "observedAt": datetime.now(timezone.utc).isoformat(), "reset": reset, "resetId": reset_id}))


def gap_token(root, scope):
    values = []
    for value in (scope, "journal:global"):
        file = gap_file(root, value)
        if file.exists():
            marker = json.loads(file.read_text())
            reset_id = marker.get("resetId", marker.get("id") if marker.get("reset", True) else None)
            if reset_id:
                values.append(reset_id)
    return digest(values) if values else None


def capture_error(error):
    reason = str(error)
    if "capacity" in reason:
        return "capture_capacity"
    if "recovery" in reason:
        return "recovery_uncertain"
    if "reordered" in reason:
        return "source_reordered"
    if isinstance(error, (ValueError, TypeError, KeyError)):
        return "contract_violation"
    return "capture_failure"


def recover(root):
    intent_path = root / "intent.json"
    if not intent_path.exists():
        return
    intent = json.loads(intent_path.read_text())
    current = file_digest(Path(intent["target"]))
    if isinstance(intent["digest"], str) and current == intent["digest"]:
        if intent["entry"]["batches"]:
            ready = root / "ready" / intent["entryName"]
            archived = root / "archive" / intent["entryName"]
            if not archived.exists():
                save(ready, encoded(intent["entry"]))
        save(root / "state.json", encoded(intent["state"]))
    elif current != intent["previous"]:
        # Never let an ambiguous old publication poison every future writer.
        mark_gap(root, [batch["scope"] for batch in intent["entry"]["batches"]], "recovery_uncertain")
    intent_path.unlink()
    sync_dir(root)


def original_json(path, payload):
    """Fixture/default publisher. Production hooks pass their original writer."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def acquire(lock, timeout=0.1):
    end = time.monotonic() + timeout
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            if time.monotonic() >= end:
                return False
            time.sleep(0.005)


def projections_for(root, path, payload, scopes):
    # Project markets independently: one malformed market does not erase
    # valid observations in another market from the same publication.
    projections = []
    candidates = payload.get("territory_verification", []) if scopes[0].startswith("schedule:") else [None]
    for territory in candidates:
        candidate = {**payload, "territory_verification": [territory]} if territory is not None else payload
        affected = [f"schedule:{payload['date']}:market-{territory.get('territory_id')}"] if territory and str(territory.get('territory_id')) in MARKETS else scopes
        try:
            result = project(path, candidate)
            if not result:
                mark_gap(root, affected, "contract_violation")
            projections.extend(result)
        except Exception as error:
            mark_gap(root, affected, capture_error(error))
    if not candidates:
        mark_gap(root, scopes, "contract_violation")
    return projections


PAGE_FIELDS = {"status", "type", "truck", "time", "end"}


def later(*values):
    return max(values, key=lambda value: datetime.fromisoformat(value))


def merge_schedule(root, batch, prior, owner, collected_at, recorded_at):
    """Independent evidence intervals for shared page facts and verified crew.
    Never changes business-source data. First verified detail seeds silently;
    subsequent non-overlapping detail changes remain eligible across stream reads.
    """
    known = prior.get("facts", {})
    incoming = {item["identity"]: item["facts"] for item in batch["observations"]}
    page = {identity: {key: value for key, value in facts.items() if key in PAGE_FIELDS} for identity, facts in incoming.items()}
    old_page = {identity: {key: value for key, value in facts.items() if key in PAGE_FIELDS} for identity, facts in known.items()}
    page_checkpoint = dict(prior.get("pageCheckpoint", {}))
    if not page_checkpoint and prior:
        page_checkpoint = {"end": prior["observedAt"]}
    page_changed = page != old_page
    overlap = page_checkpoint and datetime.fromisoformat(collected_at) < datetime.fromisoformat(page_checkpoint["end"])
    if page_changed and overlap:
        retain_uncertain(root, {"scope": batch["scope"], "group": "page", "writer": owner,
            "collectedAt": collected_at, "recordedAt": recorded_at, "facts": page})
        mark_gap(root, [batch["scope"]], "ordering_uncertain", reset=False)
        page = old_page
    elif not page_checkpoint or not overlap:
        page_checkpoint = {"end": batch["observedAt"]}
    next_facts = {identity: {**{key: value for key, value in known.get(identity, {}).items() if key not in PAGE_FIELDS and key != "assignedTruck"}, **facts} for identity, facts in page.items()}
    details = {identity: dict(value) for identity, value in prior.get("detailCheckpoints", {}).items() if identity in page}
    silent = []
    for identity, facts in incoming.items():
        detail = {key: value for key, value in facts.items() if key not in PAGE_FIELDS and key != "assignedTruck"}
        if not detail or identity not in page:
            continue  # Missing enrichment / absent appointment is unknown.
        old_detail = {key: value for key, value in known.get(identity, {}).items() if key not in PAGE_FIELDS and key != "assignedTruck"}
        checkpoint = details.get(identity) or ({"end": prior["observedAt"]} if old_detail else None)
        changed = any(old_detail.get(key) != value for key, value in detail.items())
        known_changed = any(key in old_detail and old_detail[key] != value for key, value in detail.items())
        overlap = checkpoint and datetime.fromisoformat(collected_at) < datetime.fromisoformat(checkpoint["end"])
        if known_changed and overlap:
            retain_uncertain(root, {"scope": batch["scope"], "group": "assignment", "writer": owner,
                "collectedAt": collected_at, "recordedAt": recorded_at, "facts": {identity: detail}})
            mark_gap(root, [batch["scope"]], "ordering_uncertain", reset=False)
            continue
        next_facts[identity].update(detail)
        if not checkpoint or not overlap:
            # scraped_at precedes detail enrichment in the full writer. Publication
            # is the conservative upper bound of that detail collection interval.
            details[identity] = {"end": recorded_at}
        if changed and not known_changed and identity in known and page.get(identity) == old_page.get(identity):
            silent.append(identity)
    prior["pageCheckpoint"] = page_checkpoint
    prior["detailCheckpoints"] = details
    batch["silentIdentities"] = silent
    batch["observedAt"] = later(batch["observedAt"], prior["observedAt"]) if prior.get("observedAt") else batch["observedAt"]
    return next_facts


def select_batches(root, state, projections, owner, started_at, recorded_at):
    selected = []
    for original in projections:
        batch = dict(original)
        scope = batch["scope"]
        prior = state["scopes"].get(scope, {})
        if not prior and scope.split(":")[1] < state.get("retiredBefore", ""):
            mark_gap(root, ["journal:retired"], "scope_retired", reset=False)
            continue
        has_prior = bool(prior)
        collected_at = stamp(started_at or batch["observedAt"])
        schedule_facts = batch["category"] == "schedule" and all("facts" in item for item in batch["observations"])
        next_facts = merge_schedule(root, batch, prior, owner, collected_at, recorded_at) if schedule_facts else {}
        notifications = dict(prior.get("notifications", {}))
        display_changed = False
        if schedule_facts:
            incoming = {item["identity"]: item for item in batch["observations"]}
            next_notifications = {}
            labels = {"status": "Status", "type": "Type", "truck": "Truck", "time": "Time", "end": "End", "driver": "Driver", "navigator": "Navigator", "crew": "Crew"}
            for identity, facts in next_facts.items():
                item = incoming.get(identity, {})
                old = notifications.get(identity, {})
                display = item.get("display", {})
                values = dict(old.get("fields", {}))
                # Include only display values whose fact hashes survived source
                # interval reconciliation; ambiguous reads cannot describe a change.
                values.update({key: value for key, value in display.get("fields", {}).items()
                               if item.get("facts", {}).get(key) == facts.get(key)})
                label = display.get("label") or old.get("label") or "Appointment"
                changed = [key for key in facts if prior.get("facts", {}).get(identity, {}).get(key) != facts[key]]
                title = "Cancelled" if values.get("status", "").casefold() in ("cancelled", "canceled") else "New appointment" if has_prior and identity not in prior.get("facts", {}) else "Schedule updated"
                day = scope.split(":")[1]
                truck = truck_notification_title(values["truck"]) if values.get("truck") else ""
                appointment_time = values.get("time", "")
                if values.get("end") and not re.search(r"\s[-–—]\s", appointment_time):
                    appointment_time = f"{appointment_time or 'Start not verified'} - {values['end']}"
                context = {"date": day, "time": appointment_time, "label": label,
                           "status": values.get("status", ""), "truck": truck, "type": values.get("type", "")}
                job, _, customer = label.partition(" — ")
                details = [f"Date: {day}", f"Time: {appointment_time or 'Not verified'} (Central)", f"Job: {job}"]
                if customer:
                    details.append(f"Customer: {customer}")
                details += [f"{key}: {value}" for key, value in [("Truck", truck.removeprefix("Truck ")), ("Status", values.get("status")), ("Type", values.get("type"))] if value]
                accepted_page = all(item.get("facts", {}).get(key) == facts.get(key) for key in PAGE_FIELDS)
                for key in ("address", "phone"):
                    value = display.get(key, "") if accepted_page else old.get(key, "")
                    if value:
                        details.append(f"{key.title()}: {value}")
                # Display-only amounts do not become new business-event triggers.
                amount = display.get("amount", "") if accepted_page else old.get("amount", "")
                if re.fullmatch(r"\$?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?", amount) and float(amount.replace('$', '').replace(',', '')) > 0:
                    details.append(f"Recorded amount: ${float(amount.replace('$', '').replace(',', '')):,.2f}")
                for key in changed:
                    before, after = old.get("fields", {}).get(key), values.get(key, "")
                    if before is None or before == after:
                        continue
                    if key == "truck":
                        before = truck_notification_title(before).removeprefix("Truck ") if before else "Unassigned"
                        after = truck_notification_title(after).removeprefix("Truck ") if after else "Unassigned"
                    details.append(f"Changed {labels.get(key, key).lower()}: {before or 'Unassigned'} → {after or 'Unassigned'}")
                details += [f"{labels[key]}: {values[key]}" for key in ("driver", "navigator", "crew") if values.get(key)]
                completion = display.get("completion", {}) if accepted_page else old.get("completion", {})
                if completed_status(values.get("status", "")):
                    kind = {"job": "Job", "estimate": "Estimate"}.get(values.get("type", "").casefold(), "Appointment")
                    previous_status = old.get("fields", {}).get("status", "")
                    transition = bool(previous_status) and not completed_status(previous_status)
                    headline = f"{kind} Completed" if transition else f"Completed {kind} Updated"
                    title = truck if truck_key(values.get("truck", "")) else headline
                    price = completion.get("price", "")
                    if kind == "Estimate":
                        def person(value):
                            parts = value.split(",", 1)
                            return (parts[1].strip() + " " + parts[0].strip() if len(parts) == 2 else value).title()
                        crew = "  |  ".join(person(values.get(key, "")) for key in ("driver", "navigator") if values.get(key))
                        details = [headline, label, crew or "Crew: Not verified",
                                   f"Load: {completion.get('estimateLoad') or 'Not verified'}",
                                   f"Labor: {completion.get('labor') or 'Not verified'}",
                                   *completion.get("charges", []),
                                   f"Total: {price or 'Not verified'}",
                                   f"Arrival: {completion.get('arrival') or 'Not verified'}",
                                   f"Departure: {completion.get('departure') or 'Not verified'}",
                                   f"Photos: {completion.get('photos') or 'Not verified'}"]
                    else:
                        details = [headline, label, completion.get("load") or "Load size: Not verified",
                                   price or "Price: Not verified", completion.get("payment") or "Payment method: Not recorded"]
                body = "\n".join(details)
                next_notifications[identity] = {"label": label, "fields": values, "amount": amount, "completion": completion, **{key: display.get(key, "") if accepted_page else old.get(key, "") for key in ("address", "phone")}}
                incoming.setdefault(identity, {})["notification"] = {"title": title, "body": body, "schedule": context}
            display_changed = next_notifications != notifications
            notifications = next_notifications
            batch["observations"] = [{"identity": identity, "revision": digest(facts), **({"notification": incoming[identity]["notification"]} if incoming.get(identity, {}).get("notification") else {})} for identity, facts in sorted(next_facts.items())]
        observations = batch["observations"]
        signature = digest({"complete": batch["complete"], "observations": [{"identity": item["identity"], "revision": item["revision"]} for item in observations]})
        token = gap_token(root, scope)
        reset = token is not None and token != prior.get("gapToken")
        # Equal facts establish duplication, regardless of which collection began
        # first. Do not lower the accepted writer's observation watermark.
        if not reset and not display_changed and prior.get("signature") == signature:
            if prior.get("writer") == owner and collected_at >= prior.get("collectedAt", ""):
                prior["observedAt"] = max(prior["observedAt"], batch["observedAt"])
                prior["collectedAt"] = collected_at
            continue
        # A different writer may take over only after a non-overlapping read.
        # Same-writer regressed reads are also retained as ambiguous. Neither a
        # start timestamp nor a publication timestamp proves supersession.
        ambiguous = has_prior and not schedule_facts and (
            datetime.fromisoformat(collected_at) < datetime.fromisoformat(prior["observedAt"]) or
            datetime.fromisoformat(collected_at) < datetime.fromisoformat(prior.get("collectedAt", prior["observedAt"]))
        )
        if ambiguous and not schedule_facts:
            retain_uncertain(root, {"scope": scope, "writer": owner, "collectedAt": collected_at,
                                   "recordedAt": recorded_at, "batch": batch})
            mark_gap(root, [scope], "ordering_uncertain", reset=False)
            continue
        generation = uuid.uuid4().hex if reset or not prior.get("generation") else prior["generation"]
        batch.update({"sequence": 1 if reset else prior.get("sequence", 0) + 1,
                      "generation": generation, "reset": reset, "recordedAt": recorded_at})
        start_day = datetime.fromisoformat(state.get("startedAt", recorded_at)).astimezone(ZoneInfo("America/Chicago")).date().isoformat()
        record_day = datetime.fromisoformat(recorded_at).astimezone(ZoneInfo("America/Chicago")).date().isoformat()
        day = scope.split(":")[1]
        # Existing schedule bootstrap policy is unchanged. A first observation
        # of a past day's clock/geofence history cannot prove a new live event.
        batch["baseline"] = not has_prior and (batch["category"] == "schedule" or day <= start_day or day < record_day)
        if batch["baseline"] and batch["category"] != "schedule" and day < record_day:
            batch["baselineReason"] = "historical_first_seen"
        if reset:
            batch["gapId"] = token
            batch["reconcile"] = True  # preserve known observations across gaps
            batch["gapIds"] = [json.loads(gap_file(root, key).read_text())["id"] for key in (scope, "journal:global") if gap_file(root, key).exists()]
        state["scopes"][scope] = {"sequence": batch["sequence"], "signature": signature,
            "observedAt": batch["observedAt"], "generation": generation, "gapToken": token,
            "writer": owner, "collectedAt": collected_at, "facts": next_facts, "notifications": notifications,
            "pageCheckpoint": prior.get("pageCheckpoint", {}), "detailCheckpoints": prior.get("detailCheckpoints", {})}
        selected.append(batch)
    return selected


def retain_uncertain(root, value):
    directory = root / "uncertain"
    directory.mkdir(exist_ok=True, mode=0o700)
    # Equivalence excludes collection timestamps and writer path. Repeated evidence
    # retains one bounded record, never manufactures a new transition or gap ID.
    proof = value.get("facts") or {key: child for key, child in value.get("batch", {}).items() if key in ("scope", "category", "complete", "observations")}
    key = digest([value["scope"], value.get("group", "source"), proof])
    target = directory / (key + ".json")
    if target.exists():
        return
    value = {**value, "evidenceKey": key}
    files = list(directory.glob("*.json"));data = encoded(value)
    if len(files) >= MAX_ENTRIES or retained_size(files) + len(data) > MAX_BYTES:
        raise ValueError("push_uncertain_capacity")
    save(target, data)


def pending_capture(root, path, payload, scopes, started_at, source_write):
    projections = projections_for(root, path, payload, scopes)
    pending = root / "pending"
    pending.mkdir(exist_ok=True, mode=0o700)
    files = list(pending.glob("*.json")) + list(pending.glob("*.prepared")) + list((root / "pending-quarantine").glob("*.json"))
    value = {"projections": projections, "writer": hashlib.sha256(str(path.resolve()).encode()).hexdigest(),
             "startedAt": started_at, "recordedAt": datetime.now(timezone.utc).isoformat()}
    data = encoded(value)
    if len(data) > 8 * 1024 * 1024 or len(files) >= MAX_ENTRIES or retained_size(files)+len(data)>MAX_BYTES:
        raise ValueError("push_pending_capacity")
    name = f"{time.time_ns():020d}-{uuid.uuid4().hex}"
    # An interrupted original write must never be treated as committed. Keep
    # a prepared marker so recovery can expose that scoped uncertainty.
    prepared = pending / (name + ".prepared")
    save(prepared, encoded({"scopes": scopes, "pid": os.getpid()}))
    try:
        source_write()
    except Exception:
        prepared.unlink(missing_ok=True)
        raise
    value["recordedAt"] = datetime.now(timezone.utc).isoformat()
    save(pending / (name + ".json"), encoded(value))
    prepared.unlink(missing_ok=True)
    sync_dir(pending)


def drain_pending(root):
    commit = root / "pending-commit.json"
    def finish():
        value = json.loads(commit.read_text())
        if value["entry"]["batches"] and not (root / "archive" / value["entryName"]).exists():
            save(root / "ready" / value["entryName"], encoded(value["entry"]))
        save(root / "state.json", encoded(value["state"]))
        (root / "pending" / value["pendingName"]).unlink(missing_ok=True)
        (root / "pending" / Path(value["pendingName"]).with_suffix(".prepared")).unlink(missing_ok=True)
        commit.unlink()
        sync_dir(root / "pending")
        sync_dir(root)
    if commit.exists():
        finish()
    pending = root / "pending"
    if not pending.exists():
        return
    for file in sorted(pending.glob("*.json")):
        try:
            value = json.loads(file.read_text())
            state_path = root / "state.json"
            state = json.loads(state_path.read_text()) if state_path.exists() else {"ordinal": 0, "scopes": {}, "startedAt": value["recordedAt"]}
            selected = select_batches(root, state, value["projections"], value["writer"], value["startedAt"], value["recordedAt"])
            ready = root / "ready"
            ready.mkdir(exist_ok=True, mode=0o700)
            entries = list(ready.glob("*.json")) + list((root / "quarantine").glob("*.json"))
            entry = {"version": 2, "batches": selected}
            if selected and (len(entries)>=MAX_ENTRIES or retained_size(entries)+len(encoded(entry))>MAX_BYTES):
                return  # pending remains durable; a later acknowledgement wakes us
            if len(state["scopes"])>1000 or len(encoded(state)) > MAX_BYTES:
                raise ValueError("push_scope_capacity")
            if selected:
                state["ordinal"] += 1
            save(commit, encoded({"state": state, "entry": entry, "entryName": f"{state['ordinal']:016d}.json", "pendingName": file.name}))
            finish()
        except (ValueError, TypeError, KeyError) as error:
            # Atomic spool files are private and normally produced here. Retain
            # deterministic corruption without blocking another valid record.
            quarantine = root / "pending-quarantine"
            quarantine.mkdir(exist_ok=True, mode=0o700)
            mark_gap(root, ["journal:pending"], capture_error(error), reset=False)
            file.replace(quarantine / file.name)
            sync_dir(pending)
            sync_dir(quarantine)
    # A committed spool record already processed needs no uncertainty marker.
    # For an unfinished write, a live PID is not proof of failure: leave it alone.
    for prepared in pending.glob("*.prepared"):
        value = json.loads(prepared.read_text())
        try:
            os.kill(int(value["pid"]), 0)
        except ProcessLookupError:
            mark_gap(root, value["scopes"], "recovery_uncertain")
            prepared.unlink()
        except PermissionError:
            pass



# Local supervisor capability: no collector restart or Slack change is needed to
# pause capture. Absent/invalid/expired lease fails closed; never follows symlinks.
# Explicit enabled= is only the existing local test adapter.
CAPTURE_HOME = Path('/Users/missioncontrol/Library/Application Support/OpsCenter/web-push')

def capture_lease(home=CAPTURE_HOME, now=None):
    now = time.time() if now is None else now
    try:
        info = home.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            return None
        fd = os.open(home / 'capture-lease.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 1024:
                return None
            value = json.loads(os.read(fd, 1025))
        finally:
            os.close(fd)
        expiry = value.get('expiresAt')
        if value.get('mode') not in ('observe', 'send') or value.get('version') != 1 or not isinstance(expiry, (float, int)) or not now < expiry <= now + 10 or not re.fullmatch('[a-f0-9]{32}', value.get('nonce', '')):
            return None
        root = home / 'journal'
        info = root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            return None
        return root
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def publish_json(path, payload, *, journal_root=None, enabled=None, fault=None, publisher=None, observation_started_at=None):
    """Capture failure cannot suppress the original write or its caller (Slack).

    The disabled path calls the original publisher exactly once, with no journal
    I/O. When the capture environment flag is absent it first checks the private lease. Canonical I/O failures still propagate normally. A bounded lock protects
    the healthy publication/intent boundary; contention retains a private spool capture for ordered recovery.
    """
    path = Path(path)
    publish = publisher or (lambda: original_json(path, payload))
    lease_root = capture_lease() if enabled is None and "OPSCENTER_WEB_PUSH_CAPTURE" not in os.environ else None
    active = (os.environ.get("OPSCENTER_WEB_PUSH_CAPTURE") == "1" or lease_root is not None) if enabled is None else enabled
    if not active:
        publish()
        return
    scopes = ["journal:global"]
    configured = journal_root or lease_root or os.environ.get("OPSCENTER_WEB_PUSH_JOURNAL_DIR")
    root = Path(configured) if configured and Path(configured).is_absolute() else None
    attempted = False
    source_error = None
    def source_write():
        nonlocal attempted, source_error
        attempted = True
        try:
            publish()
        except Exception as error:
            source_error = error
            raise
    try:
        scopes = source_scopes(path, payload)
        if not scopes:
            source_write()
            return
        if root is None:
            raise ValueError("push_journal_directory_required")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(root, 0o700)
        # A marker beside the source survives an unavailable journal directory.
        fallback = path.with_name(".push-gap-" + hashlib.sha256(str(path).encode()).hexdigest()[:16] + ".json")
        with (root / "writer.lock").open("a") as lock:
            if not acquire(lock):
                pending_capture(root, path, payload, scopes, observation_started_at, source_write)
                return
            recover(root)
            drain_pending(root)
            if fallback.exists():
                mark_gap(root, scopes, "capture_failure")
                fallback.unlink()
            state_path = root / "state.json"
            state = json.loads(state_path.read_text()) if state_path.exists() else {"ordinal": 0, "scopes": {}, "startedAt": datetime.now(timezone.utc).isoformat()}
            projections = projections_for(root, path, payload, scopes)
            if scopes[0].startswith("schedule:") and enabled is None and not observation_started_at:
                mark_gap(root, scopes, "contract_violation")
                projections = []
            selected = select_batches(root, state, projections, hashlib.sha256(str(path.resolve()).encode()).hexdigest(), observation_started_at, datetime.now(timezone.utc).isoformat())
            if len(state["scopes"]) > 1000 or len(encoded(state)) > MAX_BYTES:
                raise ValueError("push_scope_capacity")
            ready = root / "ready"
            ready.mkdir(exist_ok=True, mode=0o700)
            entries = list(ready.glob("*.json")) + list((root / "quarantine").glob("*.json"))
            entry = {"version": 2, "batches": selected}
            if len(encoded(entry)) > 8 * 1024 * 1024 or (selected and (len(entries) >= MAX_ENTRIES or retained_size(entries) + len(encoded(entry)) > MAX_BYTES)):
                raise ValueError("push_journal_capacity")
            if selected:
                state["ordinal"] += 1
            # Prepare hashed facts before the original writer. On an exception,
            # the outer guard ALWAYS invokes the original writer if not attempted.
            # For custom writers use their exact serialized result's digest after
            # publication; an interruption before that update yields an explicit gap.
            intent = {"target": str(path.resolve()), "previous": file_digest(path), "digest": None,
                      "entryName": f"{state['ordinal']:016d}.json", "entry": entry, "state": state}
            save(root / "intent.json", encoded(intent))
            if fault:
                fault("prepared")
            source_write()
            intent["digest"] = file_digest(path)
            save(root / "intent.json", encoded(intent))
            if fault:
                fault("published")
            recover(root)
            if fault:
                fault("committed")
    except Exception as error:
        if source_error is not None:
            raise source_error
        if not attempted:
            source_write()
        # Projection, queue, locking, recovery and private-storage errors are
        # push failures only. They never escape into source/Slack publication.
        code = capture_error(error)
        try:
            if root is None:
                raise OSError("journal unavailable")
            mark_gap(root, scopes, code)
        except Exception:
            try:
                fallback = path.with_name(".push-gap-" + hashlib.sha256(str(path).encode()).hexdigest()[:16] + ".json")
                save(fallback, encoded({"code": code, "scopes": scopes}))
            except Exception:
                # Disk failure can make durable diagnostics impossible; never
                # pretend complete coverage, and still preserve the source result.
                pass
        print("OpsCenter push coverage gap: " + code, file=sys.stderr)


def evidence_scopes(value):
    scopes = set()
    def visit(item):
        if isinstance(item, dict):
            if isinstance(item.get("scope"), str):
                scopes.add(item["scope"])
            if isinstance(item.get("scopes"), list):
                scopes.update(scope for scope in item["scopes"] if isinstance(scope, str))
            for child in item.values():
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)
    visit(value)
    return scopes


def finish_expiry(root):
    intent = root / "expiry-intent.json"
    if not intent.exists():
        return
    value = json.loads(intent.read_text())
    # The intent fixes the resulting aggregate counts. Replaying it after any
    # interruption cannot count or delete an item twice, nor delete changed data.
    for item in value["files"]:
        target = root / item["directory"] / item["name"]
        if target.exists():
            if file_digest(target) != item["digest"]:
                raise ValueError("expiry_evidence_changed")
            target.unlink();sync_dir(target.parent)
    save(root / "retention-audit.json", encoded(value["auditAfter"]))
    intent.unlink();sync_dir(root)


def retire_scopes(root, cutoff, acknowledgements):
    """Expire only proved old notification evidence; never business-source files.
    Caller holds DB source locks and certifies no pending/sending deliveries.
    Ready/pending publication references remain protected regardless of age.
    """
    date.fromisoformat(cutoff);finish_expiry(root)
    state_path = root / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {"ordinal": 0, "scopes": {}}
    state["retiredBefore"] = max(cutoff, state.get("retiredBefore", cutoff))
    save(state_path, encoded(state))  # durable replay floor before any deletion
    ack_by_scope = {ack["scope"]: ack for ack in acknowledgements}
    referenced, protected = set(), set()
    unknown_protected = False
    for directory in ("ready", "pending"):
        for file in (root / directory).glob("*"):
            if file.suffix not in (".json", ".prepared"):
                continue
            try:
                scopes = evidence_scopes(json.loads(file.read_text()))
                protected.update(scopes)
                unknown_protected |= not bool(scopes)
            except (ValueError, OSError):
                unknown_protected = True
    files, unknown_withheld = [], 0
    for directory in ("quarantine", "pending-quarantine", "uncertain"):
        for file in (root / directory).glob("*.json"):
            try:
                scopes = evidence_scopes(json.loads(file.read_text()))
            except (ValueError, OSError):
                scopes = set()
            # Unscopable evidence is retained. It cannot establish an expired
            # service day, but cannot bypass the replay floor to revive an old one.
            if not scopes or any(not re.fullmatch(r"(?:schedule|krewe|fleet):\d{4}-\d{2}-\d{2}(?::market-(?:352|477|399|484))?", scope) for scope in scopes):
                unknown_withheld += 1;continue
            can_expire = not unknown_protected and all(scope.split(":")[1] < cutoff and scope not in protected and ack_by_scope.get(scope, {}).get("discardWithheld") is True for scope in scopes)
            if can_expire:
                files.append({"directory": directory, "name": file.name, "digest": file_digest(file), "bytes": file.stat().st_size})
            else:
                referenced.update(scopes)
    audit_path = root / "retention-audit.json"
    audit = json.loads(audit_path.read_text()) if audit_path.exists() else {"expired": {}, "bytes": 0, "retiredScopes": 0}
    audit.update({"throughDay": max(cutoff, audit.get("throughDay", cutoff)), "producerOrdinal": max(state.get("ordinal", 0), audit.get("producerOrdinal", 0)), "unscopableRetained": unknown_withheld})
    if files:
        for item in files:
            audit["expired"][item["directory"]] = audit["expired"].get(item["directory"], 0) + 1
            audit["bytes"] += item["bytes"]
        save(root / "expiry-intent.json", encoded({"files": files, "auditAfter": audit}))
        finish_expiry(root)
    else:
        save(audit_path, encoded(audit))
    if unknown_protected:
        return []
    retired, newly_retired = [], 0
    for ack in acknowledgements:
        scope = ack["scope"]
        if scope.split(":")[1] >= cutoff or scope in referenced or scope in protected:
            continue
        prior = state["scopes"].get(scope)
        matches = not prior or (prior.get("generation") == ack["generation"] and prior["sequence"] == ack["sequence"])
        # Explicit obsolete-evidence disposition permits an ahead/poisoned
        # checkpoint to retire only under both floors and the same no-pending proof.
        if not matches and ack.get("discardWithheld") is not True:
            continue
        newly_retired += int(bool(prior) or gap_file(root, scope).exists())
        state["scopes"].pop(scope, None)
        gap_file(root, scope).unlink(missing_ok=True)
        retired.append(scope)
    # Metadata retirement is idempotent; aggregate count lives with the checkpoint.
    state["retiredScopeCount"] = state.get("retiredScopeCount", 0) + newly_retired
    save(state_path, encoded(state))
    if (root / "gaps").exists():
        sync_dir(root / "gaps")
    return retired


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Recover or pause a private capture journal; no sending")
    parser.add_argument("--recover", type=Path)
    parser.add_argument("--pause", type=Path)
    parser.add_argument("--retire", type=Path)
    parser.add_argument("--acknowledgements")
    parser.add_argument("--acknowledgements-file", type=Path)
    parser.add_argument("--cutoff")
    args = parser.parse_args()
    root = args.recover or args.pause or args.retire
    if not root or not root.is_absolute() or not root.is_dir():
        raise SystemExit("push_journal_unavailable")
    with (root / "writer.lock").open("a") as lock:
        if not acquire(lock, timeout=5):
            raise SystemExit("push_journal_busy")
        finish_expiry(root)
        recover(root)
        drain_pending(root)
        if args.retire:
            if args.acknowledgements_file and args.acknowledgements_file.resolve().parent != root.resolve():
                raise SystemExit("acknowledgements_file_outside_journal")
            acknowledgements = args.acknowledgements_file.read_text() if args.acknowledgements_file else args.acknowledgements
            print(json.dumps(retire_scopes(root, args.cutoff, json.loads(acknowledgements))))
        if args.pause:
            state_path = root / "state.json"
            state = json.loads(state_path.read_text()) if state_path.exists() else {"ordinal": 0, "scopes": {}}
            if state["scopes"]:
                mark_gap(root, list(state["scopes"]), "capture_disabled")
            state["startedAt"] = datetime.now(timezone.utc).isoformat()
            save(state_path, encoded(state))
