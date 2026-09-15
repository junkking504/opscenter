#!/usr/bin/env python3
"""Collect privacy-sensitive Linxup history for one America/Chicago date."""

from __future__ import annotations

import argparse
import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from linxup_common import (
    LINXUP_HISTORY,
    LinxupError,
    collected_at,
    date_bounds,
    epoch_ms,
    iso_utc,
    keychain_secret,
    mappings_for_date,
    parse_timestamp,
    tracker_log_alias,
    write_json,
)


V2_BASE_URL = "https://www.awaregps.com/ibis/rest/api/v2"
KEYCHAIN_SERVICE = "opsbot-linxup-api-token-v2"
MAX_RETRIES = 5


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


def records(payload: Any, preferred_key: str | None = None) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    value = payload.get("data", payload)
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict):
        if preferred_key and isinstance(value.get(preferred_key), list):
            return [row for row in value[preferred_key] if isinstance(row, dict)]
        for candidate in value.values():
            if isinstance(candidate, list):
                return [row for row in candidate if isinstance(row, dict)]
    return []


def first(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if row.get(key) not in (None, ""):
            return row[key]
    return None


def tracker_id(row: dict[str, Any]) -> str:
    return str(first(row, "deviceUUID", "imei", "deviceNbr", "deviceSerialNumber") or "").strip()


def normalize_point(
    row: dict[str, Any],
    truck: str,
    expected_tracker: str,
    timestamp: Any = None,
    delivery_source: str = "v2_poll",
) -> dict[str, Any] | None:
    actual_tracker = tracker_id(row) or expected_tracker
    if actual_tracker != expected_tracker:
        return None
    stamp = parse_timestamp(timestamp if timestamp is not None else first(row, "date", "timestamp", "positionDate", "editDate"))
    lat = first(row, "latitude", "lat")
    lon = first(row, "longitude", "lon", "lng")
    if stamp is None or lat in (None, "") or lon in (None, ""):
        return None
    source_id = first(row, "positionUUID", "locationUUID", "id")
    if not source_id:
        source_id = f"derived-{tracker_log_alias(actual_tracker)}-{int(stamp.timestamp() * 1000)}"
    ignition = first(row, "ignition", "ignitionState", "deviceReportTypeCode")
    return {
        "timestamp": iso_utc(stamp),
        "tracker_id": actual_tracker,
        "truck_number": truck,
        "latitude": float(lat),
        "longitude": float(lon),
        "speed": float(first(row, "speed") or 0),
        "ignition_state": ignition,
        "heading": first(row, "heading", "direction"),
        "source_record_id": str(source_id),
        "delivery_source": delivery_source,
    }


def normalize_stop_points(row: dict[str, Any], truck: str, expected_tracker: str) -> list[dict[str, Any]]:
    """Represent a stationary API stop as two linked, zero-speed GPS observations."""
    actual_tracker = tracker_id(row) or expected_tracker
    if actual_tracker != expected_tracker:
        return []
    begin = parse_timestamp(first(row, "beginDate", "startDateTime"))
    end = parse_timestamp(first(row, "endDate", "endDateTime"))
    lat = first(row, "latitude", "lat")
    lon = first(row, "longitude", "lon", "lng")
    if begin is None or end is None or end < begin or lat in (None, "") or lon in (None, ""):
        return []
    raw_id = str(first(row, "stopUUID", "id") or f"derived-{tracker_log_alias(actual_tracker)}-{int(begin.timestamp())}")
    common = {
        "tracker_id": actual_tracker,
        "truck_number": truck,
        "latitude": float(lat),
        "longitude": float(lon),
        "speed": 0.0,
        "ignition_state": first(row, "stopType") or "stationary_stop",
        "heading": None,
        "continuous_stop_id": raw_id,
        "delivery_source": "v2_poll",
    }
    return [
        {**common, "timestamp": iso_utc(begin), "source_record_id": f"{raw_id}:begin", "continuous_until": iso_utc(end)},
        {**common, "timestamp": iso_utc(end), "source_record_id": f"{raw_id}:end", "continuous_until": iso_utc(end)},
    ]


def deduplicate_points(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[Any, ...], dict[str, Any]] = {}
    for point in points:
        key = (
            point["tracker_id"],
            point["timestamp"],
            round(point["latitude"], 7),
            round(point["longitude"], 7),
        )
        unique[key] = point
    return sorted(unique.values(), key=lambda row: (row["timestamp"], row["tracker_id"]))


def normalized_v3_push_points(
    target: date,
    mappings: list[Any],
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    """Replay durable V3 position pushes so a later V2 poll cannot erase them."""
    push_directory = LINXUP_HISTORY / "push" / target.isoformat()
    if not push_directory.exists():
        return []

    by_vehicle_name = {
        row.linxup_vehicle_name.strip().lower(): row
        for row in mappings
        if row.linxup_vehicle_name.strip()
    }
    by_tracker_id = {
        str(row.linxup_tracker_id).strip(): row
        for row in mappings
        if str(row.linxup_tracker_id).strip()
    }
    points: list[dict[str, Any]] = []
    for push_file in sorted(push_directory.glob("position-*.json")):
        try:
            envelope = json.loads(push_file.read_text(encoding="utf-8"))
            payload = envelope.get("payload") if isinstance(envelope, dict) else None
            if not isinstance(payload, dict):
                continue
            tracker = payload.get("tracker") if isinstance(payload, dict) else None
            name = str(tracker.get("name") or "").strip().lower() if isinstance(tracker, dict) else ""
            tracker_id_value = str(
                tracker.get("trackerId") or tracker.get("id") or ""
            ).strip() if isinstance(tracker, dict) else ""
            mapping = by_vehicle_name.get(name) or by_tracker_id.get(tracker_id_value)
            if not mapping:
                continue
            position_date = payload.get("date") or payload.get("positionDate")
            engine_on = payload.get("engineOn")
            point = normalize_point(
                {
                    "deviceUUID": mapping.linxup_tracker_id,
                    "latitude": payload.get("latitude"),
                    "longitude": payload.get("longitude"),
                    "speed": payload.get("speed"),
                    # normalize_point reads "ignition"/"ignitionState"/"deviceReportTypeCode";
                    # passing engine state under "status" meant every V3 push point
                    # landed with ignition_state=None while V2 poll points carried it.
                    "ignition": "ON" if engine_on is True else "OFF" if engine_on is False else payload.get("status"),
                    "heading": payload.get("heading") or payload.get("direction"),
                    "positionUUID": f"v3-position-{tracker_id_value or mapping.linxup_tracker_id}-{position_date}",
                },
                mapping.junkware_truck_number,
                mapping.linxup_tracker_id,
                position_date,
                "v3_position_push",
            )
            if point and envelope.get("received_at"):
                point["received_at"] = envelope["received_at"]
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            continue
        if not point:
            continue
        stamp = parse_timestamp(point["timestamp"])
        if stamp is not None and start.astimezone(timezone.utc) <= stamp <= end.astimezone(timezone.utc):
            points.append(point)
    return points


def validate_points(points: list[dict[str, Any]], target: date, valid_trackers: set[str], collection_time: datetime) -> None:
    start, end = date_bounds(target, include_next_day_hours=6)
    previous: tuple[str, str] | None = None
    seen: set[tuple[Any, ...]] = set()
    for point in points:
        stamp = parse_timestamp(point["timestamp"])
        if stamp is None or not (start.astimezone(timezone.utc) <= stamp <= end.astimezone(timezone.utc)):
            raise LinxupError("Normalized point falls outside the requested date plus midnight-overrun window")
        if stamp > collection_time:
            raise LinxupError("Normalized point has a future timestamp")
        if point["tracker_id"] not in valid_trackers:
            raise LinxupError("Normalized point uses a tracker without a valid effective-dated mapping")
        key = (point["tracker_id"], point["timestamp"], round(point["latitude"], 7), round(point["longitude"], 7))
        if key in seen:
            raise LinxupError("Duplicate normalized point survived deduplication")
        seen.add(key)
        order = (point["timestamp"], point["tracker_id"])
        if previous and order < previous:
            raise LinxupError("Normalized points are not sorted")
        previous = order


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, help="America/Chicago service date (YYYY-MM-DD)")
    args = parser.parse_args()
    target = date.fromisoformat(args.date)
    mappings = mappings_for_date(target)
    if not mappings:
        raise SystemExit("No verified active Linxup vehicle mappings exist for the requested date")

    token = os.environ.get("LINXUP_API_KEY", "").strip()
    if token.lower().startswith("bearer "):
        token = token.split(None, 1)[1].strip()
    if not token:
        token = keychain_secret(KEYCHAIN_SERVICE)
    start, end = date_bounds(target, include_next_day_hours=6)
    body = {"fromDate": epoch_ms(start), "toDate": epoch_ms(end)}
    raw_responses: dict[str, Any] = {}

    # All-device endpoints preserve raw evidence and reduce API calls. The 30-hour
    # window remains below Linxup v2's documented 48-hour maximum.
    for name, endpoint in (
        ("locations", "locations/all"),
        ("trips", "trips"),
        ("stops", "stops"),
        ("advanced_trips", "advancedTrips"),
    ):
        raw_responses[name] = request_json(f"{V2_BASE_URL}/{endpoint}", token, method="POST", body=body)

    # Validate the source timestamps against the instant the complete LinxUp
    # response set was received, not the instant polling began.  A response may
    # legitimately contain a position recorded while the earlier endpoints were
    # still in flight; comparing it to the pre-request clock falsely rejects a
    # good refresh and leaves the prior snapshot in place.
    collection_time = datetime.now(timezone.utc)

    raw_path = LINXUP_HISTORY / "raw" / f"linxup_location_{target.isoformat()}.json"
    normalized_path = LINXUP_HISTORY / f"linxup_location_{target.isoformat()}.json"
    raw_payload = {
        "schema_version": 1,
        "source": "Linxup v2 API",
        "date": target.isoformat(),
        "timezone": "America/Chicago",
        "requested_from": start.isoformat(),
        "requested_through": end.isoformat(),
        "collection_timestamp": iso_utc(collection_time),
        "responses": raw_responses,
    }
    write_json(raw_path, raw_payload)

    by_tracker = {row.linxup_tracker_id: row for row in mappings}
    points: list[dict[str, Any]] = []
    for row in records(raw_responses["locations"], "locations"):
        mapping = by_tracker.get(tracker_id(row))
        if mapping:
            point = normalize_point(row, mapping.junkware_truck_number, mapping.linxup_tracker_id)
            if point:
                points.append(point)
    # Advanced-trip moving rows may provide history on accounts where locations/all
    # is sparse; only records with actual coordinates and timestamps become points.
    for row in records(raw_responses["advanced_trips"], "advancedTrips"):
        mapping = by_tracker.get(tracker_id(row))
        if mapping:
            point = normalize_point(
                row,
                mapping.junkware_truck_number,
                mapping.linxup_tracker_id,
                first(row, "date", "startDate", "startDateTime"),
            )
            if point:
                points.append(point)
    for row in records(raw_responses["stops"], "stops"):
        mapping = by_tracker.get(tracker_id(row))
        if mapping:
            points.extend(normalize_stop_points(row, mapping.junkware_truck_number, mapping.linxup_tracker_id))

    # A V3 position is durable evidence.  Merge it after V2 data so an exact
    # duplicate keeps the direct push record, and a subsequent minute poll does
    # not make OpsCenter regress to the older poll-only view.
    v3_points = normalized_v3_push_points(target, mappings, start, end)
    points.extend(v3_points)

    start_utc, end_utc = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    points = [
        point for point in points
        if (stamp := parse_timestamp(point.get("timestamp"))) is not None and start_utc <= stamp <= end_utc
    ]
    points = deduplicate_points(points)
    for point in points:
        point["collection_timestamp"] = iso_utc(collection_time)
    validate_points(points, target, set(by_tracker), collection_time)
    latest_v3_position_at = max(
        (point["timestamp"] for point in points if point.get("delivery_source") == "v3_position_push"),
        default=None,
    )
    latest_v2_position_at = max(
        (point["timestamp"] for point in points if point.get("delivery_source") == "v2_poll"),
        default=None,
    )
    normalized = {
        "schema_version": 1,
        "source": "LinxUp V2 API + V3 Position Push" if v3_points else "LinxUp V2 API",
        "date": target.isoformat(),
        "timezone": "America/Chicago",
        "collection_timestamp": iso_utc(collection_time),
        "delivery": {
            "authoritative_source": "v3_position_push",
            "current_mode": "v3_position_push" if latest_v3_position_at else "v2_poll_fallback",
            "fallback_source": "v2_poll",
            "v3_position_push": {
                "merged": bool(v3_points),
                "latest_position_at": latest_v3_position_at,
                "point_count": sum(1 for point in points if point.get("delivery_source") == "v3_position_push"),
            },
            "v2_poll": {
                "enabled_as_fallback": True,
                "latest_position_at": latest_v2_position_at,
                "point_count": sum(1 for point in points if point.get("delivery_source") == "v2_poll"),
            },
        },
        "mapped_tracker_count": len(mappings),
        "points": points,
        "trips": records(raw_responses["trips"], "trips"),
        "stops": records(raw_responses["stops"], "stops"),
        "ignition_events": records(raw_responses["advanced_trips"], "advancedTrips"),
        "validation": {
            "requested_boundaries_verified": True,
            "timezone_verified": True,
            "points_unique": True,
            "points_sorted": True,
            "future_timestamps_absent": True,
            "tracker_mapping_valid": True,
            "v3_position_push_merged": bool(v3_points),
        },
    }
    write_json(normalized_path, normalized)
    print(json.dumps({"date": target.isoformat(), "mapped_trackers": len(mappings), "points": len(points), "status": "ok"}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except LinxupError as exc:
        raise SystemExit(str(exc))
