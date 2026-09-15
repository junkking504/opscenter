#!/usr/bin/env python3
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, time
from zoneinfo import ZoneInfo

from linxup_common import keychain_secret
from opsbot_paths import ensure_history_dirs, linxup_raw_path, linxup_summary_path, relpath


BASE_URL = "https://www.awaregps.com/ibis/rest/api/v2"
TIMEZONE = ZoneInfo("America/Chicago")
KEYCHAIN_SERVICE = "opsbot-linxup-api-token-v2"


def local_today():
    return datetime.now(TIMEZONE).date()


def epoch_ms(dt):
    return int(dt.timestamp() * 1000)


def request_json(url, api_key, method="GET", body=None):
    data = None
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def response_array(payload, key_name):
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, dict) and isinstance(data.get(key_name), list):
            return data[key_name]
        if isinstance(data, list):
            return data
    if isinstance(payload, list):
        return payload
    return []


def device_key(row):
    return (
        row.get("imei")
        or row.get("deviceNbr")
        or row.get("deviceUUID")
        or row.get("deviceSerialNumber")
        or ""
    )


def vehicle_id(row):
    return (
        row.get("deviceUUID")
        or row.get("imei")
        or row.get("deviceNbr")
        or row.get("deviceSerialNumber")
        or ""
    )


def truck_name(row):
    first = (row.get("firstName") or "").strip()
    last = (row.get("lastName") or "").strip()
    combined = (first + (" " + last if last else "")).strip()
    return combined or (row.get("driverName") or row.get("personName") or "").strip()


def format_ms(ms):
    if not ms:
        return ""
    try:
        return datetime.fromtimestamp(int(ms) / 1000, TIMEZONE).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ""


def format_minutes(minutes):
    minutes = int(round(float(minutes or 0)))
    return f"{minutes // 60}:{minutes % 60:02d}"


def round_miles(value):
    try:
        return f"{float(value):.1f}"
    except Exception:
        return "0.0"


def main():
    import argparse
    from datetime import date as _date
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=None)
    args = parser.parse_args()

    api_key = os.environ.get("LINXUP_API_KEY", "").strip()
    if api_key.lower().startswith("bearer "):
        api_key = api_key.split(None, 1)[1].strip()
    if not api_key:
        api_key = keychain_secret(KEYCHAIN_SERVICE)
    if not api_key:
        raise SystemExit("LINXUP_API_KEY is missing and Keychain fallback was unavailable")

    if args.date:
        target_date = _date.fromisoformat(args.date)
    else:
        target_date = local_today()
    start = datetime.combine(target_date, time.min, TIMEZONE)
    end = datetime.combine(target_date, time.max, TIMEZONE)
    start_ms = epoch_ms(start)
    end_ms = epoch_ms(end)
    date_slug = target_date.isoformat()

    ensure_history_dirs()
    raw_path = linxup_raw_path(date_slug)
    summary_path = linxup_summary_path(date_slug)
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)

    date_body = {"fromDate": start_ms, "toDate": end_ms}

    errors = []
    raw = {
        "source": "LinxUp API",
        "retrieved_at": datetime.now(TIMEZONE).isoformat(),
        "window": {
            "timezone": "America/Chicago",
            "from_ms": start_ms,
            "to_ms": end_ms,
        },
        "responses": {},
    }

    endpoints = {
        "locations": ("GET", f"{BASE_URL}/locations", None),
        "trips": ("POST", f"{BASE_URL}/trips", date_body),
        "stops": ("POST", f"{BASE_URL}/stops", date_body),
        "trackers": ("GET", f"{BASE_URL}/tracker", None),
    }

    for name, (method, url, body) in endpoints.items():
        try:
            raw["responses"][name] = request_json(url, api_key, method=method, body=body)
        except urllib.error.HTTPError as exc:
            errors.append(f"{name}: HTTP {exc.code}")
            raw["responses"][name] = {"error": f"HTTP {exc.code}"}
        except Exception as exc:
            errors.append(f"{name}: {type(exc).__name__}")
            raw["responses"][name] = {"error": type(exc).__name__}

    raw_path.write_text(json.dumps(raw, indent=2), encoding="utf-8")

    locations = response_array(raw["responses"].get("locations"), "locations")
    trips = response_array(raw["responses"].get("trips"), "trips")
    stops = response_array(raw["responses"].get("stops"), "stops")

    summary = {}
    for loc in locations:
        key = device_key(loc)
        if not key:
            continue
        summary[key] = {
            "truck_name": truck_name(loc),
            "vehicle_id": vehicle_id(loc),
            "first_movement": None,
            "last_movement": None,
            "miles_driven": 0.0,
            "drive_minutes": 0,
            "idle_minutes": 0,
            "stop_minutes": 0,
            "current_status": loc.get("status") or "",
        }

    for trip in trips:
        key = device_key(trip)
        if not key:
            continue
        row = summary.setdefault(
            key,
            {
                "truck_name": truck_name(trip),
                "vehicle_id": vehicle_id(trip),
                "first_movement": None,
                "last_movement": None,
                "miles_driven": 0.0,
                "drive_minutes": 0,
                "idle_minutes": 0,
                "stop_minutes": 0,
                "current_status": "",
            },
        )
        start_time = trip.get("startDateTime")
        end_time = trip.get("endDateTime")
        if start_time:
            row["first_movement"] = (
                start_time
                if row["first_movement"] is None
                else min(row["first_movement"], start_time)
            )
        if end_time:
            row["last_movement"] = (
                end_time
                if row["last_movement"] is None
                else max(row["last_movement"], end_time)
            )
        row["drive_minutes"] += int(trip.get("durationMinutes") or 0)
        row["miles_driven"] += float(
            trip.get("distanceMilesDetailed")
            if trip.get("distanceMilesDetailed") is not None
            else trip.get("distanceMiles") or 0
        )

    for stop in stops:
        key = device_key(stop)
        if not key:
            continue
        row = summary.setdefault(
            key,
            {
                "truck_name": truck_name(stop),
                "vehicle_id": vehicle_id(stop),
                "first_movement": None,
                "last_movement": None,
                "miles_driven": 0.0,
                "drive_minutes": 0,
                "idle_minutes": 0,
                "stop_minutes": 0,
                "current_status": "",
            },
        )
        duration = int(stop.get("duration") or 0)
        if (stop.get("stopType") or "").lower() == "idling":
            row["idle_minutes"] += duration
        else:
            row["stop_minutes"] += duration

    with summary_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "truck_name",
                "vehicle_id",
                "first_movement",
                "last_movement",
                "miles_driven",
                "drive_time",
                "idle_time",
                "stop_time",
                "current_status",
            ]
        )
        for row in sorted(summary.values(), key=lambda item: item["truck_name"].lower()):
            writer.writerow(
                [
                    row["truck_name"],
                    row["vehicle_id"],
                    format_ms(row["first_movement"]),
                    format_ms(row["last_movement"]),
                    round_miles(row["miles_driven"]),
                    format_minutes(row["drive_minutes"]),
                    format_minutes(row["idle_minutes"]),
                    format_minutes(row["stop_minutes"]),
                    row["current_status"],
                ]
            )

    print(
        json.dumps(
            {
                "trucks_found": len(summary),
                "files_created": [relpath(raw_path), relpath(summary_path)],
                "errors": errors,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
