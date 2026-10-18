"""Private, retained publication journal. No networking, credentials or timers.

Opt-in only. Writers use one flock for prepare -> snapshot rename -> ready ->
checkpoint. Recovery commits an interrupted publish only if its exact snapshot
is on disk; otherwise the old snapshot must still match before aborting it.
Only hashes of selected event facts enter the journal, never source records.
"""
from __future__ import annotations
import fcntl
import hashlib
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

MAX_ENTRIES = 10000
MAX_BYTES = 128 * 1024 * 1024
MARKETS = {"352": "New Orleans", "477": "Northshore", "399": "Baton Rouge", "484": "Jefferson Parish"}


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


def observation(identity, revision):
    return {"identity": digest(identity), "revision": digest(revision)}


def project(path, payload):
    """Strict producer contracts; unsupported/missing evidence yields no coverage."""
    day = str(payload.get("date", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return []
    parsed = date.fromisoformat(day)
    today = datetime.now(timezone.utc).date()
    # Old backfills and distant forecasts are outside live push coverage.
    if not today - timedelta(days=7) <= parsed <= today + timedelta(days=90):
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
    if path.name in (f"junkware_schedule_fast_{day}.json", f"junkware_{day}.json") and isinstance(payload.get("appointments"), list):
        verification = payload.get("territory_verification")
        if not isinstance(verification, list):
            return []
        rows = payload["appointments"] + payload.get("completed", []) + payload.get("cancelled", [])
        for verified in verification:
            market = str(verified.get("territory_id", ""))
            if verified.get("verified") is not True or market not in MARKETS:
                continue
            selected = [row for row in rows if first(row, "market", "territory") == MARKETS[market]]
            # Never interpret an unclassified row as a complete-market removal.
            if any(first(row, "market", "territory") not in MARKETS.values() for row in rows):
                continue
            items_by_id = {}
            for row in selected:
                identity = first(row, "appt_id", "appointment_id")
                if not identity:
                    raise ValueError("schedule_identity_missing")
                facts = {
                    "status": first(row, "job_status", "status").casefold(),
                    "type": first(row, "appointment_type").casefold(),
                    "truck": first(row, "assigned_truck", "truck", "truck_number"),
                    "time": first(row, "appointment_time", "schedule_time", "time", "start_time"),
                    "end": first(row, "end_time"),
                    "driver": first(row, "driver_name", "driver").casefold(),
                    "navigator": first(row, "navigator_name", "navigator").casefold(),
                    "crew": row.get("additional_crew") or row.get("crew") or "",
                }
                if row in payload.get("cancelled", []):
                    facts["status"] = "cancelled"
                items_by_id[identity] = observation(identity, facts)
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
                    items.append(observation([name, kind], value))
        batch(f"krewe:{day}", "krewe", source.get("as_of"), items)
    elif path.name == f"linxup_alerts_{day}.json":
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
            items.append(observation(row["alert_id"], {key: row.get(key) for key in ("alert_type_normalized", "alert_type", "truck_number", "geofence_name", "occurred_at", "duration_seconds")}))
        batch(f"fleet:{day}", "fleet", payload.get("collection_timestamp"), items)
    return batches


def recover(root):
    intent_path = root / "intent.json"
    if not intent_path.exists():
        return
    intent = json.loads(intent_path.read_text())
    current = file_digest(Path(intent["target"]))
    if current == intent["digest"]:
        if intent["entry"]["batches"]:
            ready = root / "ready" / intent["entryName"]
            archived = root / "archive" / intent["entryName"]
            if not archived.exists():
                save(ready, encoded(intent["entry"]))
        save(root / "state.json", encoded(intent["state"]))
    elif current != intent["previous"]:
        raise ValueError("publication_recovery_uncertain")
    intent_path.unlink()
    sync_dir(root)


def publish_json(path, payload, *, journal_root=None, enabled=None, fault=None):
    """Keep ordinary publication behavior when disabled; no journal access.

    Explicit args are for local fixtures. Production uses separately approved
    capture settings. Sending has its own independent disabled-by-default gate.
    """
    path = Path(path)
    active = os.environ.get("OPSCENTER_WEB_PUSH_CAPTURE") == "1" if enabled is None else enabled
    if not active:
        save(path, (json.dumps(payload, indent=2) + "\n").encode())
        return
    configured = journal_root or os.environ.get("OPSCENTER_WEB_PUSH_JOURNAL_DIR")
    if not configured or not Path(configured).is_absolute():
        raise ValueError("push_journal_directory_required")
    root = Path(configured)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    with (root / "writer.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        recover(root)
        batches = project(path, payload)
        if not batches:
            save(path, (json.dumps(payload, indent=2) + "\n").encode())
            return
        state_path = root / "state.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {"ordinal": 0, "scopes": {}}
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat()
        state["scopes"] = {key: value for key, value in state["scopes"].items() if key.split(":")[1] >= cutoff}
        selected = []
        for batch in batches:
            previous = state["scopes"].get(batch["scope"], {})
            if previous and datetime.fromisoformat(batch["observedAt"]) < datetime.fromisoformat(previous["observedAt"]):
                raise ValueError("source_publication_reordered")
            signature = digest({"complete": batch["complete"], "observations": batch["observations"]})
            # Identical recaptures need no log entry or notification.
            if previous.get("signature") == signature:
                previous["observedAt"] = batch["observedAt"]
                continue
            batch["sequence"] = previous.get("sequence", 0) + 1
            state["scopes"][batch["scope"]] = {"sequence": batch["sequence"], "signature": signature, "observedAt": batch["observedAt"]}
            selected.append(batch)
        if len(state["scopes"]) > 1000:
            raise ValueError("push_scope_capacity")
        ready = root / "ready"
        ready.mkdir(exist_ok=True, mode=0o700)
        entries = list(ready.glob("*.json"))
        # No unacknowledged entry is discarded to make room. Operators must
        # recover the consumer; capture fails visibly if bounded capacity fills.
        entry = {"version": 1, "batches": selected}
        if len(encoded(entry)) > 8 * 1024 * 1024:
            raise ValueError("push_entry_capacity")
        if selected and (len(entries) >= MAX_ENTRIES or retained_size(entries) + len(encoded(entry)) > MAX_BYTES):
            raise ValueError("push_journal_capacity")
        if selected:
            state["ordinal"] += 1
        entry_name = f"{state['ordinal']:016d}.json"
        data = (json.dumps(payload, indent=2) + "\n").encode()
        intent = {"target": str(path.resolve()), "previous": file_digest(path), "digest": hashlib.sha256(data).hexdigest(),
                  "entryName": entry_name, "entry": entry, "state": state}
        save(root / "intent.json", encoded(intent))
        if fault:
            fault("prepared")
        save(path, data)
        if fault:
            fault("published")
        recover(root)
        if fault:
            fault("committed")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Recover a prepared local journal publication; no sending")
    parser.add_argument("--recover", type=Path, required=True)
    args = parser.parse_args()
    if not args.recover.is_absolute() or not args.recover.is_dir():
        raise SystemExit("push_journal_unavailable")
    with (args.recover / "writer.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        recover(args.recover)
