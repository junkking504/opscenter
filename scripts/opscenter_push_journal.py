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
                    facts.update({"driver": first(row, "driver_name", "driver").casefold(),
                                  "navigator": first(row, "navigator_name", "navigator").casefold(),
                                  "crew": row.get("additional_crew") or row.get("crew") or "",
                                  "assignedTruck": first(row, "assigned_truck", "truck")})
                item = observation(identity, facts)
                item["facts"] = {key: digest(value) for key, value in facts.items()}
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
    if path.name == f"linxup_alerts_{day}.json":
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


def select_batches(root, state, projections, owner, started_at, recorded_at):
    selected = []
    for original in projections:
        batch = dict(original)
        scope = batch["scope"]
        prior = state["scopes"].get(scope, {})
        if not prior and scope.split(":")[1] < state.get("retiredBefore", ""):
            mark_gap(root, ["journal:retired"], "scope_retired", reset=False)
            continue
        collected_at = stamp(started_at or batch["observedAt"])
        known_facts = prior.get("facts", {})
        next_facts = {}
        observations = []
        for item in batch["observations"]:
            if "facts" in item:
                combined = {**known_facts.get(item["identity"], {}), **item["facts"]}
                next_facts[item["identity"]] = combined
                observations.append({"identity": item["identity"], "revision": digest(combined)})
            else:
                observations.append(item)
        batch["observations"] = observations
        signature = digest({"complete": batch["complete"], "observations": observations})
        token = gap_token(root, scope)
        reset = token is not None and token != prior.get("gapToken")
        # Equal facts establish duplication, regardless of which collection began
        # first. Do not lower the accepted writer's observation watermark.
        if not reset and prior.get("signature") == signature:
            if prior.get("writer") == owner and collected_at >= prior.get("collectedAt", ""):
                prior["observedAt"] = max(prior["observedAt"], batch["observedAt"])
                prior["collectedAt"] = collected_at
            continue
        # A different writer may take over only after a non-overlapping read.
        # Same-writer regressed reads are also retained as ambiguous. Neither a
        # start timestamp nor a publication timestamp proves supersession.
        ambiguous = prior and (
            datetime.fromisoformat(collected_at) < datetime.fromisoformat(prior["observedAt"]) or
            datetime.fromisoformat(collected_at) < datetime.fromisoformat(prior.get("collectedAt", prior["observedAt"]))
        )
        if ambiguous:
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
        batch["baseline"] = not prior and (batch["category"] == "schedule" or day <= start_day or day < record_day)
        if batch["baseline"] and batch["category"] != "schedule" and day < record_day:
            batch["baselineReason"] = "historical_first_seen"
        if reset:
            batch["gapId"] = token
            batch["reconcile"] = True  # preserve known observations across gaps
            batch["gapIds"] = [json.loads(gap_file(root, key).read_text())["id"] for key in (scope, "journal:global") if gap_file(root, key).exists()]
        state["scopes"][scope] = {"sequence": batch["sequence"], "signature": signature,
            "observedAt": batch["observedAt"], "generation": generation, "gapToken": token,
            "writer": owner, "collectedAt": collected_at, "facts": next_facts}
        selected.append(batch)
    return selected


def retain_uncertain(root, value):
    directory = root / "uncertain"
    directory.mkdir(exist_ok=True, mode=0o700)
    files = list(directory.glob("*.json"))
    data = encoded(value)
    if len(files) >= MAX_ENTRIES or retained_size(files) + len(data) > MAX_BYTES:
        raise ValueError("push_uncertain_capacity")
    # Facts are hashes only. Preserve ambiguous evidence for reconciliation,
    # rather than fabricate a transition or claim a later start supersedes it.
    save(directory / (digest(value) + ".json"), data)


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



def publish_json(path, payload, *, journal_root=None, enabled=None, fault=None, publisher=None, observation_started_at=None):
    """Capture failure cannot suppress the original write or its caller (Slack).

    The disabled path calls the original publisher exactly once, with no journal
    I/O. Canonical I/O failures still propagate normally. A bounded lock protects
    the healthy publication/intent boundary; contention retains a private spool capture for ordered recovery.
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


def retire_scopes(root, cutoff, acknowledgements):
    """Called only by the approved dispatcher with DB acknowledgements held.
    Never removes source files or retained evidence. Metadata-only, replay-safe.
    """
    date.fromisoformat(cutoff)
    state_path = root / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {"ordinal": 0, "scopes": {}}
    state["retiredBefore"] = max(cutoff, state.get("retiredBefore", cutoff))
    # Persist compact replay barrier before any metadata can be removed.
    save(state_path, encoded(state))
    referenced = set()
    def visit(value):
        if isinstance(value, dict):
            if isinstance(value.get("scope"), str):
                referenced.add(value["scope"])
            if isinstance(value.get("scopes"), list):
                referenced.update(value["scopes"])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    for directory in ("ready", "pending", "quarantine", "pending-quarantine", "uncertain"):
        for file in (root / directory).glob("*"):
            if file.suffix not in (".json", ".prepared"):
                continue
            try:
                visit(json.loads(file.read_text()))
            except (ValueError, OSError):
                return []  # Unknown retained evidence cannot prove safe deletion.
    retired = []
    for ack in acknowledgements:
        scope = ack["scope"]
        if scope.split(":")[1] >= cutoff or scope in referenced:
            continue
        prior = state["scopes"].get(scope)
        if prior and (prior.get("generation") != ack["generation"] or prior["sequence"] != ack["sequence"]):
            continue
        state["scopes"].pop(scope, None)
        gap_file(root, scope).unlink(missing_ok=True)
        retired.append(scope)
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
    parser.add_argument("--cutoff")
    args = parser.parse_args()
    root = args.recover or args.pause or args.retire
    if not root or not root.is_absolute() or not root.is_dir():
        raise SystemExit("push_journal_unavailable")
    with (root / "writer.lock").open("a") as lock:
        if not acquire(lock, timeout=5):
            raise SystemExit("push_journal_busy")
        recover(root)
        drain_pending(root)
        if args.retire:
            print(json.dumps(retire_scopes(root, args.cutoff, json.loads(args.acknowledgements))))
        if args.pause:
            state_path = root / "state.json"
            state = json.loads(state_path.read_text()) if state_path.exists() else {"ordinal": 0, "scopes": {}}
            if state["scopes"]:
                mark_gap(root, list(state["scopes"]), "capture_disabled")
            state["startedAt"] = datetime.now(timezone.utc).isoformat()
            save(state_path, encoded(state))
