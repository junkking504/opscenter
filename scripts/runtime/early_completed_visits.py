"""Recover completed work before its booked window from existing daily GPS.

This is a conservative second pass, not a wider live-arrival geofence. It
requires a finished, sustained visit, one physical truck, verified premises,
and no competing appointment or already-owned physical interval.
"""
from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from datetime import datetime, time, timezone


def recover_early_completed_visits(matcher, rows, target):
    appointments = matcher.deduplicate_appointments(matcher.appointment_source(target), target)
    by_id = defaultdict(list)
    for row in rows:
        by_id[str(row.get('appointment_id') or '')].append(row)
    candidates = []
    for job in appointments:
        status = str(job.get('job_status') or job.get('status') or '')
        identity = job['_appointment_id']
        existing = by_id[identity]
        if (identity.startswith('derived-') or re.search('cancel', status, re.I)
                or not re.search(r'\b(completed?|closed)\b', status, re.I)
                or not existing or any(row.get('match_confidence') != 'no_visit_detected'
                                       or row.get('visit_intervals') for row in existing)):
            continue
        start, _ = matcher.parse_window(target, job.get('appointment_time') or '')
        if start:
            candidates.append((job, existing, start))
    if not candidates:
        return rows

    pins = json.loads(matcher.GEOCODE_CACHE_PATH.read_text()).get('addresses', {})
    def location(job):
        address = matcher.normalize_address(job.get('address') or '')
        pin = pins.get(matcher.address_hash(address), {}) if address else {}
        lat, lon = pin.get('latitude'), pin.get('longitude')
        if (pin.get('match_confidence') != 'confirmed' or pin.get('house_street_verified') is not True
                or not isinstance(lat, (float, int)) or not isinstance(lon, (float, int))
                or not math.isfinite(lat) or not math.isfinite(lon)
                or not (29 <= lat <= 31.3 and -93 <= lon <= -89.4)):
            return None
        return lat, lon

    gps = json.loads((matcher.LINXUP_HISTORY / f'linxup_location_{target.isoformat()}.json').read_text())
    mappings = {row.junkware_truck_number: row for row in matcher.mappings_for_date(target)}
    points = defaultdict(list)
    now = datetime.now(timezone.utc)
    midnight = datetime.combine(target, time.min, matcher.LOCAL_TZ)
    for point in gps.get('points', []):
        stamp = matcher.parse_timestamp(point.get('timestamp'))
        if stamp and midnight <= stamp <= now and stamp.astimezone(matcher.LOCAL_TZ).date() == target:
            points[matcher.normalize_truck(point.get('truck_number'))].append(point)
    recovered = {}
    for job, existing, booked_start in candidates:
        pin = location(job)
        if not pin:
            continue
        # Even a nearby second booking can make a recovered episode ambiguous.
        # Normal, already-attributed visits are not changed by this safeguard.
        if any(other['_appointment_id'] != job['_appointment_id']
               and (other_pin := location(other))
               and matcher.haversine_meters(*pin, *other_pin) <= 2 * matcher.DEFAULT_RADIUS_METERS
               for other in appointments):
            continue
        matches = []
        for truck, history in points.items():
            if truck not in mappings:
                continue
            # Preserve the installed qualifier; use stronger dwell than the
            # immediate-arrival policy for retrospective attribution.
            visits, distance, gaps, pass_by = matcher.qualifying_visits(
                history, *pin, matcher.DEFAULT_RADIUS_METERS, 5, 3,
                matcher.DEFAULT_DEPARTURE_GRACE_MINUTES)
            early = [v for v in visits if v.get('departure_confirmed') is True
                     and (end := matcher.parse_timestamp(v.get('departure')))
                     and end < booked_start and not v.get('boundary_coverage_gaps')
                     and 5 <= float(v.get('onsite_minutes') or 0) <= matcher.DEFAULT_MAX_VISIT_MINUTES]
            if early and not pass_by:
                matches.append((truck, early, distance, gaps))
        if len(matches) != 1:
            continue
        truck, visits, distance, gaps = matches[0]
        intervals = [(matcher.parse_timestamp(v['arrival']), matcher.parse_timestamp(v['departure'])) for v in visits]
        collision = False
        for other in [*rows, *recovered.values()]:
            if (str(other.get('appointment_id')) == job['_appointment_id']
                    or matcher.normalize_truck(other.get('truck_number')) != truck):
                continue
            for visit in other.get('visit_intervals', []):
                start = matcher.parse_timestamp(visit.get('arrival'))
                end = matcher.parse_timestamp(visit.get('departure')) or now
                if start and any(start < b and end > a for a, b in intervals):
                    collision = True
        if collision:
            continue
        row = dict(existing[0])
        total = round(sum(float(v['onsite_minutes']) for v in visits), 2)
        row.update(truck_number=truck, tracker_id=mappings[truck].linxup_tracker_id,
                   arrival_at=visits[0]['arrival'], first_arrival=visits[0]['arrival'],
                   departure_at=visits[-1]['departure'], final_departure=visits[-1]['departure'],
                   duration_minutes=total, onsite_minutes=total, visit_count=len(visits), visit_intervals=visits,
                   source_timestamps=[s for v in visits for s in v['source_timestamps']],
                   matched_gps_point_count=sum(v['inside_point_count'] for v in visits),
                   minimum_distance_to_appointment=round(distance, 2),
                   match_confidence='confirmed', match_status='verified',
                   match_reason='completed_early_full_day_gps_dwell',
                   assignment_mismatch_flag=truck not in job.get('_trucks', []),
                   gps_coverage_quality='good', gps_coverage_gaps=gaps,
                   pass_by_only=False, nearby_stop_intervals=[])
        row.update(matcher.interval_metrics(intervals), truck_count=1)
        recovered[job['_appointment_id']] = row
    return [row for row in rows if str(row.get('appointment_id')) not in recovered] + list(recovered.values())
