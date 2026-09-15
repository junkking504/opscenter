"""Strict TLS transport and failure status for the existing LinxUp collectors."""
from __future__ import annotations

import argparse
import json
import random
import ssl
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from linxup_common import LinxupError, write_json


def validate_response(payload):
    """Reject API/error envelopes before permissive legacy parsers see them."""
    if isinstance(payload, dict):
        if payload.get("error") or payload.get("errors") or payload.get("success") is False:
            raise LinxupError("LinxUp API returned an error envelope")
        value = payload.get("data", payload)
    else:
        value = payload
    arrays = [value] if isinstance(value, list) else [v for v in value.values() if isinstance(v, list)] if isinstance(value, dict) else []
    if not arrays or any(not isinstance(row, dict) for rows in arrays for row in rows):
        raise LinxupError("LinxUp API returned an invalid records envelope")
    return payload


def request_json(url, token, method="GET", body=None, *, max_attempts=5, timeout=60):
    encoded = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if encoded is not None:
        headers["Content-Type"] = "application/json"
    # Explicit verification also protects against a changed global urllib context.
    context = ssl.create_default_context()
    for attempt in range(max_attempts):
        request = urllib.request.Request(url, data=encoded, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
                return validate_response(json.loads(response.read().decode("utf-8")))
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == max_attempts - 1:
                raise LinxupError(f"LinxUp request failed with HTTP {exc.code}") from exc
            retry_after = exc.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else 2**attempt + random.random()
            time.sleep(min(delay, 60))
        except (urllib.error.URLError, ssl.SSLError, TimeoutError) as exc:
            reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
            if isinstance(reason, ssl.SSLCertVerificationError):
                # Certificate expiry/hostname/trust failures cannot heal via immediate retries.
                code = getattr(reason, "verify_code", None)
                detail = {10: "certificate expired", 9: "certificate not yet valid", 62: "hostname mismatch"}.get(code, "certificate verification failed")
                raise LinxupError(f"TLS verification failed: {detail} (verify_code={code}); previous snapshot retained") from exc
            if attempt == max_attempts - 1:
                raise LinxupError(f"LinxUp request failed: {type(reason).__name__}") from exc
            time.sleep(min(2**attempt + random.random(), 30))
        except (ValueError, UnicodeError) as exc:
            raise LinxupError("LinxUp API returned invalid JSON") from exc
    raise LinxupError("LinxUp request exhausted retries")


def source_paths(name, target):
    from opsbot_paths import linxup_raw_path, linxup_alerts_path, linxup_alerts_status_path
    if name == "alerts":
        return linxup_alerts_path(target), linxup_alerts_status_path(target)
    root = linxup_raw_path(target).parent
    if name == "daily":
        return linxup_raw_path(target), root / f"linxup_{target}_status.json"
    return root / f"linxup_location_{target}.json", root / f"linxup_location_{target}_status.json"


def snapshot_time(path):
    try:
        value = json.loads(path.read_text())
        if value.get("collection_errors") or value.get("source_status") == "failed":
            return None
        responses = value.get("responses", {})
        if isinstance(responses, dict) and any(isinstance(row, dict) and row.get("error") for row in responses.values()):
            return None
        return value.get("collection_timestamp") or value.get("retrieved_at")
    except (OSError, ValueError, AttributeError):
        return None


def run_collector(name, collect):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--date", default=datetime.now(ZoneInfo("America/Chicago")).date().isoformat())
    args, _ = parser.parse_known_args()
    target = date.fromisoformat(args.date).isoformat()
    snapshot, status_path = source_paths(name, target)
    previous_time = snapshot_time(snapshot)
    attempted_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        result = collect()
        if result not in (None, 0):
            raise LinxupError("LinxUp collector did not complete")
    except Exception as exc:
        # Do not publish a new collection timestamp or mutate retained data on failure.
        reason = str(exc) if isinstance(exc, LinxupError) else type(exc).__name__
        write_json(status_path, {
            "schema_version": 1, "source": f"LinxUp {name}", "date": target,
            "source_status": "failed", "status": "stale" if previous_time else "missing",
            "attempted_at": attempted_at, "collection_timestamp": previous_time,
            "last_success_at": previous_time, "source_path": str(snapshot),
            "preserved_existing": snapshot.exists(), "validation_status": "failed",
            "collection_error": reason, "collection_errors": [reason],
        })
        print(json.dumps({"source": name, "status": "failed", "reason": reason}))
        return 1
    # Alerts writes additional useful status fields; keep them on successful collection.
    status = {}
    if name == "alerts" and status_path.exists():
        try:
            status = json.loads(status_path.read_text())
        except (OSError, ValueError):
            pass
    success_time = snapshot_time(snapshot)
    status.update({
        "schema_version": 1, "source": f"LinxUp {name}", "date": target,
        "source_status": "success", "status": "current", "attempted_at": attempted_at,
        "collection_timestamp": success_time, "last_success_at": success_time,
        "source_path": str(snapshot), "preserved_existing": False,
        "validation_status": "passed", "collection_error": "", "collection_errors": [],
    })
    write_json(status_path, status)
    return 0
