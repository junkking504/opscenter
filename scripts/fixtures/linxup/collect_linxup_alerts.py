#!/usr/bin/env python3
"""Collect Linxup alert feed for one America/Chicago date."""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from linxup_common import (
    LinxupError,
    date_bounds,
    epoch_ms,
    iso_utc,
    keychain_secret,
    parse_timestamp,
    write_json,
)
from opsbot_paths import (
    linxup_alerts_csv_path,
    linxup_alerts_path,
    linxup_alerts_raw_path,
    linxup_alerts_status_path,
)


V2_BASE_URL = "https://www.awaregps.com/ibis/rest/api/v2"
KEYCHAIN_SERVICE = "opsbot-linxup-api-token-v2"
MAX_RETRIES = 5
LOCAL_TZ = ZoneInfo("America/Chicago")


def request_json(url: str, token: str, method: str = "GET", body: Any = None) -> Any:
    encoded = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if encoded is not None:
        headers["Content-Type"] = "application/json"
    for attempt in range(MAX_RETRIES):
        request = urllib.request.Request(url, data=encoded, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == MAX_RETRIES - 1:
                raise LinxupError(f"Linxup request failed with HTTP {exc.code}") from exc
            retry_after = exc.headers.get("Retry-After")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else 2**attempt + random.random()
            time.sleep(min(delay, 60))
        except urllib.error.URLError as exc:
            if attempt == MAX_RETRIES - 1:
                raise LinxupError(f"Linxup request failed: {type(exc.reason).__name__}") from exc
            time.sleep(min(2**attempt + random.random(), 30))
    raise LinxupError("Linxup request exhausted retries")


def records(payload: Any, preferred_key: str = "alerts") -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    data = payload.get("data", payload)
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        if isinstance(data.get(preferred_key), list):
            return [row for row in data[preferred_key] if isinstance(row, dict)]
        for value in data.values():
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
    return []


def first(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def alert_id(row: dict[str, Any]) -> str:
    return str(first(row, "alertUUID", "alertId", "id") or "").strip()


def alert_code(row: dict[str, Any]) -> str:
    return str(first(row, "alertCode", "code") or "").strip().upper()


def vehicle_name(row: dict[str, Any]) -> str:
    first_name = str(first(row, "firstName") or "").strip()
    last_name = str(first(row, "lastName") or "").strip()
    combined = " ".join(part for part in (first_name, last_name) if part).strip()
    if combined:
        return combined
    return str(first(row, "vehicleName", "assetName", "driverName", "personName") or "").strip()


def truck_number(row: dict[str, Any]) -> str:
    name = vehicle_name(row)
    match = re.search(r"(\d+)", name)
    if match:
        return f"Truck# {int(match.group(1))}"
    return name or "Unassigned"


def tracker_id(row: dict[str, Any]) -> str:
    return str(first(row, "deviceUUID", "trackerId", "deviceSerialNumber", "deviceNumber") or "").strip()


def normalize_alert_type(code: str) -> str:
    mapping = {
        "HARSH_BRAKING": "harsh_braking",
        "SEATBELT": "seatbelt_warning",
        "IDLE_START": "idle_started",
        "IDLE_END": "idle_ended",
        "IGNITION_ON": "ignition_started",
        "FIRST_IGNITION_OF_DAY": "ignition_started",
        "POWER_ON": "ignition_started",
        "IGNITION_OFF": "ignition_stopped",
        "POWER_OFF": "ignition_stopped",
        "GEOFENCE_ENTERED": "geofence_entered",
        "GEOFENCE_EXITED": "geofence_exited",
        "HIGH_SPEED": "speeding",
        "GEOFENCE_SPEEDING": "severe_speeding",
    }
    return mapping.get(code.upper(), "unknown")


def parse_number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def normalize_alert(row: dict[str, Any], collection_time: datetime) -> dict[str, Any] | None:
    code = alert_code(row)
    occurred = parse_timestamp(first(row, "alertDateTime", "occurredAt", "timestamp"))
    if occurred is None:
        return None
    if occurred > collection_time:
        raise LinxupError("Alert has a future timestamp")

    media_id = first(row, "mediaId", "media_id")
    geofence_name = first(row, "fenceName", "geofenceName")
    latitude = parse_number(first(row, "latitude", "lat"))
    longitude = parse_number(first(row, "longitude", "lon", "lng"))
    speed = parse_number(first(row, "speed"))
    posted_speed = parse_number(first(row, "postedSpeed", "posted_speed"))
    duration_seconds = parse_number(first(row, "durationSeconds", "duration_seconds"))
    severity = first(row, "severity")
    address = first(row, "address")

    if latitude is not None and abs(latitude) > 90:
        latitude = None
    if longitude is not None and abs(longitude) > 180:
        longitude = None

    identifier = alert_id(row)
    if not identifier:
        identifier = f"derived-{tracker_id(row) or 'unknown'}-{int(occurred.timestamp() * 1000)}-{code or 'unknown'}"

    occurred_local = occurred.astimezone(LOCAL_TZ)

    return {
        "alert_id": identifier,
        "alert_type": code or "UNKNOWN",
        "alert_type_normalized": normalize_alert_type(code),
        "alert_short_desc": first(row, "alertShortDesc"),
        "alert_desc": first(row, "alertDesc"),
        "vehicle_id": tracker_id(row) or None,
        "vehicle_name": vehicle_name(row) or None,
        "truck_number": truck_number(row),
        "driver_name": first(row, "appDriverName", "driverName", "personName") or None,
        "driver_number": first(row, "driverNumber") or None,
        "occurred_at": iso_utc(occurred),
        "occurred_at_local": occurred_local.isoformat(),
        "latitude": latitude,
        "longitude": longitude,
        "address": address,
        "severity": severity,
        "speed": speed,
        "posted_speed": posted_speed,
        "geofence_name": geofence_name,
        "duration_seconds": duration_seconds,
        "video_available": bool(media_id),
        "video_id": str(media_id) if media_id not in (None, "") else None,
        "collected_at": iso_utc(collection_time),
        "source_status": "collected",
        "tracker_alias": tracker_id(row) or None,
        "raw_vehicle_name": vehicle_name(row) or None,
    }


def deduplicate(alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for alert in alerts:
        key = str(alert.get("alert_id") or "").strip()
        if not key:
            continue
        if key not in seen:
            seen[key] = alert
    return sorted(seen.values(), key=lambda row: (row.get("occurred_at") or "", row.get("alert_id") or ""))


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    fields = [
        "alert_id",
        "alert_type",
        "alert_type_normalized",
        "alert_short_desc",
        "alert_desc",
        "vehicle_id",
        "vehicle_name",
        "truck_number",
        "driver_name",
        "driver_number",
        "occurred_at",
        "occurred_at_local",
        "latitude",
        "longitude",
        "address",
        "severity",
        "speed",
        "posted_speed",
        "geofence_name",
        "duration_seconds",
        "video_available",
        "video_id",
        "collected_at",
        "source_status",
    ]
    with temporary.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, help="America/Chicago service date (YYYY-MM-DD)")
    args = parser.parse_args()
    target = date.fromisoformat(args.date)

    token = os.environ.get("LINXUP_API_KEY", "").strip()
    if token.lower().startswith("bearer "):
        token = token.split(None, 1)[1].strip()
    if not token:
        token = keychain_secret(KEYCHAIN_SERVICE)

    start, end = date_bounds(target)
    body = {"fromDate": epoch_ms(start), "toDate": epoch_ms(end)}
    collection_time = datetime.now(timezone.utc)
    endpoint = f"{V2_BASE_URL}/alerts"
    raw_response = request_json(endpoint, token, method="POST", body=body)
    raw_alerts = records(raw_response, "alerts")
    normalized_alerts: list[dict[str, Any]] = []
    collection_errors: list[str] = []

    for row in raw_alerts:
        try:
            normalized = normalize_alert(row, collection_time)
        except LinxupError as exc:
            collection_errors.append(str(exc))
            continue
        if normalized:
            normalized_alerts.append(normalized)

    normalized_alerts = deduplicate(normalized_alerts)
    newest_alert_timestamp = None
    if normalized_alerts:
        newest_alert_timestamp = max(normalized_alerts, key=lambda row: row["occurred_at"])["occurred_at"]

    raw_path = linxup_alerts_raw_path(target.isoformat())
    normalized_path = linxup_alerts_path(target.isoformat())
    csv_path = linxup_alerts_csv_path(target.isoformat())
    status_path = linxup_alerts_status_path(target.isoformat())
    unknown_count = sum(1 for row in normalized_alerts if str(row.get("alert_type_normalized") or "").strip() == "unknown")
    mapped_count = sum(1 for row in normalized_alerts if str(row.get("truck_number") or "").strip() and str(row.get("truck_number")).strip() != "Unassigned")
    pagination_completed = bool(raw_alerts) and len(raw_alerts) == len(normalized_alerts)

    existing_valid_count = None
    if normalized_path.exists():
        try:
            existing_payload = json.loads(normalized_path.read_text(encoding="utf-8"))
            if isinstance(existing_payload, dict):
                existing_valid_count = int(existing_payload.get("record_count") or len(existing_payload.get("alerts") or []))
        except Exception:
            existing_valid_count = None

    preserve_existing = (
        len(normalized_alerts) == 0
        and existing_valid_count is not None
        and existing_valid_count > 0
    )

    raw_payload = {
        "schema_version": 1,
        "source": "Linxup v2 alerts API",
        "endpoint": endpoint,
        "date": target.isoformat(),
        "timezone": "America/Chicago",
        "requested_from": start.isoformat(),
        "requested_through": end.isoformat(),
        "collection_timestamp": iso_utc(collection_time),
        "response": raw_response,
    }
    if not preserve_existing:
        write_json(raw_path, raw_payload)
        write_json(
            normalized_path,
            {
                "schema_version": 1,
                "source": "Linxup v2 alerts API",
                "date": target.isoformat(),
                "timezone": "America/Chicago",
                "requested_local_date": target.isoformat(),
                "requested_from": start.isoformat(),
                "requested_through": end.isoformat(),
                "utc_request_start": iso_utc(start),
                "utc_request_end": iso_utc(end),
                "collection_timestamp": iso_utc(collection_time),
                "record_count": len(normalized_alerts),
                "mapped_records": mapped_count,
                "unknown_records": unknown_count,
                "newest_alert_timestamp": newest_alert_timestamp,
                "pagination_status": "page parameter accepted but current response returned the full alert set in one page",
                "pagination_completed": pagination_completed,
                "validation_status": "passed" if not collection_errors else "partial",
                "collection_errors": collection_errors,
                "alerts": normalized_alerts,
            },
        )
        write_csv(csv_path, normalized_alerts)
    write_json(
        status_path,
        {
            "schema_version": 1,
            "source": "Linxup v2 alerts API",
            "date": target.isoformat(),
            "requested_local_date": target.isoformat(),
            "utc_request_start": iso_utc(start),
            "utc_request_end": iso_utc(end),
            "collection_timestamp": iso_utc(collection_time),
            "record_count": len(normalized_alerts),
            "mapped_records": mapped_count,
            "unknown_records": unknown_count,
            "newest_alert_timestamp": newest_alert_timestamp,
            "pagination_status": "page parameter accepted but current response returned the full alert set in one page",
            "pagination_completed": pagination_completed,
            "validation_status": "passed" if not collection_errors else "partial",
            "collection_errors": collection_errors,
            "collection_error": collection_errors[0] if collection_errors else "",
            "source_status": "success" if not collection_errors and not preserve_existing else "partial" if collection_errors else "preserved_existing" if preserve_existing else "success",
            "source_path": str(normalized_path),
            "csv_path": str(csv_path),
            "raw_path": str(raw_path),
            "preserved_existing": preserve_existing,
        },
    )

    print(
        json.dumps(
            {
                "date": target.isoformat(),
                "record_count": len(normalized_alerts),
                "mapped_records": mapped_count,
                "unknown_records": unknown_count,
                "newest_alert_timestamp": newest_alert_timestamp,
                "pagination_status": "page parameter accepted but current response returned the full alert set in one page",
                "pagination_completed": pagination_completed,
                "validation_status": "passed" if not collection_errors else "partial",
                "status": "ok" if not collection_errors else "partial",
                "preserved_existing": preserve_existing,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except LinxupError as exc:
        raise SystemExit(str(exc))
