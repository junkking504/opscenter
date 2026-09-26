"""Reconcile an exact linked estimate/job collision without inferring identity."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any, Callable


def linked_appointment_pairs(target: date, data_root: Path) -> set[tuple[str, str]]:
    path = data_root / "history" / "junkware" / f"junkware_{target.isoformat()}_raw.json"
    if not path.exists():
        return set()
    payload = json.loads(path.read_text(encoding="utf-8"))
    pairs: set[tuple[str, str]] = set()
    for key in ("appointments", "completed", "cancelled"):
        for row in payload.get(key, []):
            if not isinstance(row, dict):
                continue
            job_id = str(row.get("appt_id") or row.get("appointment_id") or "").strip()
            estimate_id = str(row.get("source_estimate_appointment_id") or row.get("sourceEstimateAppointmentId") or "").strip()
            if job_id and estimate_id and job_id != estimate_id:
                pairs.add((estimate_id, job_id))
    return pairs


def physical_visit_signature(
    row: dict[str, Any],
    parse_timestamp: Callable[[Any], Any],
    iso_utc: Callable[[Any], str],
    normalize_truck: Callable[[Any], str],
) -> tuple[Any, ...] | None:
    if row.get("match_confidence") != "confirmed" or row.get("pass_by_only"):
        return None
    intervals = row.get("visit_intervals") or []
    if not intervals:
        return None
    normalized = []
    for interval in intervals:
        arrival = parse_timestamp(interval.get("arrival"))
        departure = parse_timestamp(interval.get("departure"))
        if not arrival or not departure or departure <= arrival:
            return None
        normalized.append((iso_utc(arrival), iso_utc(departure)))
    return (normalize_truck(row.get("truck_number")), tuple(normalized))


def reconcile_linked_physical_visits(
    rows: list[dict[str, Any]],
    target: date,
    data_root: Path,
    parse_timestamp: Callable[[Any], Any],
    iso_utc: Callable[[Any], str],
    normalize_truck: Callable[[Any], str],
) -> list[dict[str, Any]]:
    """The linked job owns an identical episode; the estimate remains a source record."""
    by_appointment: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_appointment[str(row.get("appointment_id") or "")].append(row)
    signature = lambda row: physical_visit_signature(row, parse_timestamp, iso_utc, normalize_truck)
    for estimate_id, job_id in linked_appointment_pairs(target, data_root):
        job_signatures = {signature(row): row for row in by_appointment.get(job_id, [])}
        job_signatures.pop(None, None)
        for estimate in by_appointment.get(estimate_id, []):
            owner = job_signatures.get(signature(estimate))
            if not owner:
                continue
            estimate.update(
                arrival_at=None, departure_at=None, duration_minutes=0,
                first_arrival=None, final_departure=None, onsite_minutes=0,
                visit_count=0, visit_intervals=[], source_timestamps=[], matched_gps_point_count=0,
                match_status="linked_record", match_confidence="no_visit_detected",
                match_reason="physical_visit_attributed_to_linked_job",
                physical_visit_owner_appointment_id=job_id,
                physical_visit_owner_jk_number=owner.get("jk_number"),
                first_truck_arrival=None, last_truck_departure=None,
                elapsed_site_coverage_minutes=0, total_truck_minutes=0,
                peak_trucks_onsite=0, overlap_intervals=[], truck_count=0,
            )
    return rows
