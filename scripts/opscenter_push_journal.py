"""Opt-in capture with durable gaps. Source publication always wins over push.
No network, credentials or delivery timers. Only selected fact hashes are retained.
"""
from __future__ import annotations
import fcntl
import hashlib
import json
import os
import re
import sys
import time
import uuid
from zoneinfo import ZoneInfo
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
    if path.name in (f"junkware_schedule_fast_{day}.json", f"junkware_{day}_raw.json", f"junkware_schedule_requested_{day}.json") and isinstance(payload.get("appointments"), list):
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


GAP_CODES = {"capture_failure", "contract_violation", "capture_capacity", "lock_busy", "recovery_uncertain", "writer_conflict", "source_reordered", "capture_disabled", "helper_version_mismatch"}


def source_scopes(path, payload):
    day = str(payload.get("date", ""))
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return []
    if path.name in (f"junkware_schedule_fast_{day}.json", f"junkware_{day}_raw.json", f"junkware_schedule_requested_{day}.json"):
        return [f"schedule:{day}:market-{market}" for market in MARKETS]
    if path.name == f"daily_metrics_{day}.json":
        return [f"krewe:{day}"]
    if path.name == f"linxup_alerts_{day}.json":
        return [f"fleet:{day}"]
    return []


def gap_file(root, scope):
    return root / "gaps" / (hashlib.sha256(scope.encode()).hexdigest() + ".json")


def mark_gap(root, scopes, code):
    """One sticky, bounded marker per known scope; no source content/errors."""
    code = code if code in GAP_CODES else "capture_failure"
    scopes = scopes or ["journal:global"]
    directory = root / "gaps"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    for scope in scopes:
        target = gap_file(root, scope)
        if not target.exists() and len(list(directory.glob("*.json"))) >= 1000:
            scope = "journal:global"
            target = gap_file(root, scope)
        save(target, encoded({"scope": scope, "id": uuid.uuid4().hex, "code": code,
                              "observedAt": datetime.now(timezone.utc).isoformat()}))


def gap_token(root, scope):
    values = []
    for value in (scope, "journal:global"):
        file = gap_file(root, value)
        if file.exists():
            values.append(json.loads(file.read_text())["id"])
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


def acquire(lock):
    end = time.monotonic() + 0.1
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            if time.monotonic() >= end:
                return False
            time.sleep(0.005)


def publish_json(path, payload, *, journal_root=None, enabled=None, fault=None, publisher=None, observation_started_at=None):
    """Capture failure cannot suppress the original write or its caller (Slack).

    The disabled path calls the original publisher exactly once, with no journal
    I/O. Canonical I/O failures still propagate normally. A bounded lock protects
    the healthy publication/intent boundary; contention degrades to a visible gap.
    """
    path = Path(path)
    publish = publisher or (lambda: original_json(path, payload))
    active = os.environ.get("OPSCENTER_WEB_PUSH_CAPTURE") == "1" if enabled is None else enabled
    if not active:
        publish()
        return
    scopes = ["journal:global"]
    configured = journal_root or os.environ.get("OPSCENTER_WEB_PUSH_JOURNAL_DIR")
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
                source_write()
                mark_gap(root, scopes, "lock_busy")
                return
            recover(root)
            if fallback.exists():
                mark_gap(root, scopes, "capture_failure")
                fallback.unlink()
            state_path = root / "state.json"
            state = json.loads(state_path.read_text()) if state_path.exists() else {"ordinal": 0, "scopes": {}, "startedAt": datetime.now(timezone.utc).isoformat()}
            selected = []
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
            owner = hashlib.sha256(str(path.resolve()).encode()).hexdigest()
            for batch in projections:
                scope = batch["scope"]
                prior = state["scopes"].get(scope, {})
                collected_at = observation_started_at or batch["observedAt"]
                collected_at = stamp(collected_at)
                if batch["category"] == "schedule" and enabled is None and not observation_started_at:
                    mark_gap(root, [scope], "contract_violation")
                    continue
                # Collection START, not write/end time, orders competing writers.
                # A slower, older collection must never manufacture a reversion.
                if prior and datetime.fromisoformat(collected_at) < datetime.fromisoformat(prior.get("collectedAt", prior["observedAt"])):
                    mark_gap(root, [scope], "source_reordered")
                    continue
                token = gap_token(root, scope)
                reset = token is not None and token != prior.get("gapToken")
                signature = digest({"complete": batch["complete"], "observations": batch["observations"]})
                if not reset and prior.get("signature") == signature:
                    prior["observedAt"] = batch["observedAt"]
                    prior["collectedAt"] = collected_at
                    continue
                generation = uuid.uuid4().hex if reset or not prior.get("generation") else prior["generation"]
                batch.update({"sequence": 1 if reset else prior.get("sequence", 0) + 1,
                              "generation": generation, "reset": reset,
                              "recordedAt": datetime.now(timezone.utc).isoformat()})
                # Bootstrap is explicit. New service days after uninterrupted
                # capture started notify first clock/geofence facts, not old data.
                start_day = datetime.fromisoformat(state.get("startedAt", batch["recordedAt"])).astimezone(ZoneInfo("America/Chicago")).date().isoformat()
                batch["baseline"] = reset or (not prior and (batch["category"] == "schedule" or payload["date"] <= start_day))
                if reset:
                    batch["gapId"] = token
                state["scopes"][scope] = {"sequence": batch["sequence"], "signature": signature,
                    "observedAt": batch["observedAt"], "generation": generation, "gapToken": token, "writer": owner, "collectedAt": collected_at}
                selected.append(batch)
            if len(state["scopes"]) > 1000:
                raise ValueError("push_scope_capacity")
            ready = root / "ready"
            ready.mkdir(exist_ok=True, mode=0o700)
            entries = list(ready.glob("*.json"))
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


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Recover or pause a private capture journal; no sending")
    parser.add_argument("--recover", type=Path)
    parser.add_argument("--pause", type=Path)
    args = parser.parse_args()
    root = args.recover or args.pause
    if not root or not root.is_absolute() or not root.is_dir():
        raise SystemExit("push_journal_unavailable")
    with (root / "writer.lock").open("a") as lock:
        if not acquire(lock):
            raise SystemExit("push_journal_busy")
        recover(root)
        if args.pause:
            mark_gap(root, ["journal:global"], "capture_disabled")
