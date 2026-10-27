#!/usr/bin/env python3
"""Apply the immediate-arrival policy to the installed OpsBot visit matcher."""
from __future__ import annotations

import importlib.util
import os
import json
import math
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

def appointment_day_policy(source: str) -> str:
    """Apply the app-owned presence policy to the installed collector in memory.

    Keep the installed source immutable. Exact anchors fail on incompatible
    collector changes instead of silently returning to booked-time filtering.
    """
    replacements = [
        ('appointments = deduplicate_appointments(appointment_source(target), target)',
         'appointments = deduplicate_appointments(appointment_source(target), target)\n    visit_pins = resolve_visit_pins(appointments, geocodes, args.geofence_radius, target)'),
        ('geocode = geocodes.get(address_hash(address)) if address else None',
         'geocode = visit_pins.get(appointment_id)'),
        ('"geofence_radius": args.geofence_radius,\n                "minimum_distance_to_appointment": None,',
         '"visit_pin": geocode.get("visit_pin") if geocode else None,\n                "geofence_radius": args.geofence_radius,\n                "minimum_distance_to_appointment": None,'),
        ('if not geocode or geocode.get("match_confidence") != "confirmed":',
         'if not geocode or geocode.get("blocked") or geocode.get("match_confidence") not in {"confirmed", "approximate"}:'),
        ('match_reason="missing_or_ambiguous_geocode")',
         'match_reason="ambiguous_visit_pin" if geocode and geocode.get("blocked") else "missing_or_ambiguous_geocode")'),
        ('if base["match_confidence"] == "confirmed":\n                    base["match_status"] = "verified"',
         'if base["match_confidence"] == "confirmed":\n                    base["match_status"] = "approximate_pin" if geocode.get("visit_pin", {}).get("approximate") else "verified"\n                    if geocode.get("visit_pin", {}).get("approximate"):\n                        base["match_reason"] = "qualifying_gps_visit_at_approximate_pin"'),
        ('"overlap_intervals",\n    ]', '"overlap_intervals", "visit_pin",\n    ]'),
        ('if (stamp := parse_timestamp(point.get("timestamp")))\n                and search_start.astimezone(timezone.utc) <= stamp <= search_end.astimezone(timezone.utc)',
         'if (stamp := parse_timestamp(point.get("timestamp")))\n                and stamp.astimezone(LOCAL_TZ).date() == target\n                and stamp <= datetime.now(timezone.utc)\n                and stamp >= geocode.get("operational_since", datetime.min.replace(tzinfo=timezone.utc))'),
        ('too_long = any(float(visit["onsite_minutes"]) > args.maximum_visit_minutes for visit in visits)',
         'too_long = False  # Presence has no maximum duration.'),
        ('"appointment_search_window_before_minutes": args.before_minutes,',
         '"appointment_search_window_before_minutes": None,\n            "appointment_search_scope": "entire_operating_day",'),
        ('"appointment_search_window_after_minutes": args.after_minutes,',
         '"appointment_search_window_after_minutes": None,'),
        ('"maximum_plausible_visit_duration_minutes": args.maximum_visit_minutes,',
         '"maximum_plausible_visit_duration_minutes": None,'),
        ('args.minimum_dwell_minutes,\n                args.minimum_inside_points,',
         '0,  # One recorded point at the premises establishes a visit.\n                1,'),
        ('"minimum_qualifying_dwell_minutes": args.minimum_dwell_minutes,',
         '"minimum_qualifying_dwell_minutes": 0,'),
        ('"minimum_consecutive_inside_points": args.minimum_inside_points,',
         '"minimum_consecutive_inside_points": 1,'),
        ('boundary_gaps = [gap for visit in visits for gap in visit.get("boundary_coverage_gaps", [])]',
         'boundary_gaps = [gap for visit in visits for gap in visit.get("boundary_coverage_gaps", []) + visit.get("coverage_gaps", [])]'),
    ]
    for old, new in replacements:
        if source.count(old) != 1:
            raise RuntimeError('Installed visit matcher changed; review appointment-day policy anchors')
        source = source.replace(old, new, 1)
    return source


def cached_map_pins(addresses):
    """Read existing bounded provider caches through the app's shared selector."""
    app = Path(__file__).resolve().parent.parent
    result = subprocess.run(
        ['node', '--import', 'tsx', 'scripts/read-appointment-visit-pins.ts'],
        cwd=app, input=json.dumps(addresses), text=True, capture_output=True,
        check=True, timeout=60,
    )
    return json.loads(result.stdout)


def approximate_policy_start(data):
    """Start prospectively on first ordinary run; retries never backfill old GPS.

    Publish an fsynced complete file exclusively, so overlapping first runs use
    one cutoff. A corrupt policy file fails closed rather than resetting it.
    """
    directory = Path(data) / 'config'
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / 'operational-map-pin-policy.json'
    if not destination.exists():
        fd, temporary = tempfile.mkstemp(prefix='.approximate-visits-', dir=directory)
        try:
            with os.fdopen(fd, 'w') as handle:
                json.dump({'schema': 1, 'enabledAt': datetime.now(timezone.utc).isoformat()}, handle)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, destination)
            except FileExistsError:
                pass
        finally:
            os.unlink(temporary)
    state = json.loads(destination.read_text())
    start = datetime.fromisoformat(state['enabledAt'].replace('Z', '+00:00'))
    if state.get('schema') != 1 or start.tzinfo is None:
        raise ValueError('Invalid operational map pin policy; do not reset the activation cutoff')
    return start


def operational_source_start(data, identity, register, started_at):
    """Remember rollout membership across later address verification/label changes."""
    if len(identity) != 64 or any(c not in '0123456789abcdef' for c in identity):
        raise ValueError('Invalid operational source identity')
    directory = Path(data) / 'config' / 'operational-map-pin-sources'
    destination = directory / (identity + '.json')
    if not destination.exists():
        if not register:
            return None
        directory.mkdir(parents=True, exist_ok=True)
        start = started_at()
        fd, temporary = tempfile.mkstemp(prefix='.source-', dir=directory)
        try:
            with os.fdopen(fd, 'w') as handle:
                json.dump({'schema': 1, 'enabledAt': start.isoformat()}, handle)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, destination)
            except FileExistsError:
                pass
        finally:
            os.unlink(temporary)
    state = json.loads(destination.read_text())
    start = datetime.fromisoformat(state['enabledAt'].replace('Z', '+00:00'))
    if state.get('schema') != 1 or start.tzinfo is None:
        raise ValueError('Invalid operational source cutoff; do not reset it')
    return start


def configure_visit_pins(module, read_fallbacks=cached_map_pins, started_at=None):
    module.visit_policy_started_at = started_at or (lambda: approximate_policy_start(module.DATA))
    def valid(location):
        return isinstance(location, dict) and all(
            isinstance(location.get(key), (int, float)) and not isinstance(location[key], bool)
            and math.isfinite(location[key]) and abs(location[key]) <= bound
            for key, bound in [('latitude', 90), ('longitude', 180)])

    def resolve(appointments, geocodes, radius, target):
        # The bridge uses the same current address identity and cached selector
        # as Schedule. The old confidence label does not veto that coordinate.
        current = read_fallbacks([row.get('address') or '' for row in appointments])
        pins = {}
        for row in appointments:
            raw = row.get('address') or ''
            if 'cancel' in str(row.get('job_status', '')).lower() or row.get('_source_group') == 'cancelled':
                continue
            pin = current.get(raw)
            if pin and valid(pin.get('location')) and pin.get('sourceAddress', raw) == raw:
                evidence = {**pin, 'sourceAddress': raw}
                resolved = {**pin['location'], 'match_confidence': 'confirmed', 'visit_pin': evidence}
                # Newly enabled coordinate sources start prospectively. Keep the
                # existing verified history; do not replay previously ignored GPS.
                since = operational_source_start(module.DATA,
                    module.address_hash(module.normalize_address(raw)),
                    pin.get('sourceKind', 'map_fallback') == 'map_fallback', module.visit_policy_started_at)
                if since is not None:
                    resolved['operational_since'] = since
                pins[row['_appointment_id']] = resolved
            elif raw not in current:
                verified = geocodes.get(module.address_hash(module.normalize_address(raw)))
                if verified and verified.get('match_confidence') == 'confirmed' and valid(verified):
                    pins[row['_appointment_id']] = dict(verified)
        # Geometric ambiguity has the same rule for every label. Assignment and
        # booking status do not distinguish physically overlapping sites.
        values = list(pins.values())
        for index, a in enumerate(values):
            for b in values[index+1:]:
                if module.haversine_meters(a['latitude'], a['longitude'], b['latitude'], b['longitude']) <= 2 * radius:
                    a['blocked'] = b['blocked'] = True
        return pins
    module.resolve_visit_pins = resolve

    original_qualifying = getattr(module, '_base_qualifying_visits', module.qualifying_visits)
    module._base_qualifying_visits = original_qualifying

    def operational_visits(points, lat, lon, radius, dwell, count, grace):
        # Reconcile one observation per instant before visit matching. V2 may
        # later add rounded/derived coordinates for an authoritative V3 fix;
        # that enrichment must not erase the arrival or change its notice key.
        # Conflicts at the selected authority still cannot corroborate an exit.
        grouped = {}
        for point in points:
            stamp = module.parse_timestamp(point.get('timestamp'))
            if stamp and valid(point):
                grouped.setdefault(stamp, []).append(point)
        clean, ambiguous_times = [], []
        for stamp, samples in sorted(grouped.items()):
            authoritative = [p for p in samples if p.get('delivery_source') == 'v3_position_push']
            samples = authoritative or samples
            positions = {(p['latitude'], p['longitude']) for p in samples}
            if len(positions) == 1:
                clean.append(samples[0])
            else:
                ambiguous_times.append(stamp)
        # Keep the collector's coverage diagnostics, but do not use its
        # five-minute inside-point clusters as visit identities. Missing fixes
        # (including parked heartbeats) are not evidence of leaving the site.
        _, distance, gaps, _ = original_qualifying(clean, lat, lon, radius, dwell, count, grace)
        measured = [(module.parse_timestamp(p['timestamp']), p,
                     module.haversine_meters(lat, lon, p['latitude'], p['longitude'])) for p in clean]
        visits, inside, outside = [], [], []

        def finish(confirmed):
            first, last = measured[inside[0]], measured[inside[-1]]
            duration = (last[0] - first[0]).total_seconds() / 60
            if len(inside) < count or duration < dwell:
                return
            boundaries = []
            for left, right in ((measured[inside[0]-1], first) if inside[0] else (None, None),
                                (last, measured[inside[-1]+1]) if inside[-1]+1 < len(measured) else (None, None)):
                if left and right and (right[0]-left[0]).total_seconds() > 600:
                    boundaries.append({'start': module.iso_utc(left[0]), 'end': module.iso_utc(right[0]),
                                       'minutes': round((right[0]-left[0]).total_seconds()/60, 2)})
            visits.append({'arrival': module.iso_utc(first[0]),
                           # Preserve the existing last-inside endpoint policy;
                           # neither the wall clock nor silence creates an exit.
                           'departure': module.iso_utc(last[0]) if confirmed else None,
                           'departure_confirmed': confirmed, 'onsite_minutes': round(duration, 2),
                           'inside_point_count': len(inside),
                           'source_timestamps': [module.iso_utc(measured[i][0]) for i in inside],
                           'boundary_coverage_gaps': boundaries,
                           'coverage_gaps': [gap for gap in gaps if first[0] <= module.parse_timestamp(gap['start'])
                                             and module.parse_timestamp(gap['end']) <= last[0]]})

        for index, (stamp, _, meters) in enumerate(measured):
            if meters <= radius:
                inside.append(index)
                outside = []
            elif inside:
                if meters <= radius * 2:
                    outside = []  # Boundary jitter is not departure.
                    continue
                if outside and ((stamp-outside[-1]).total_seconds() > 300
                                or any(outside[-1] < uncertain < stamp for uncertain in ambiguous_times)):
                    outside = []
                outside.append(stamp)
                if (len(outside) > 1 and (stamp-outside[0]).total_seconds() >= 60
                        and (stamp-measured[inside[-1]][0]).total_seconds() >= grace*60):
                    finish(True)
                    inside, outside = [], []
        if inside:
            finish(False)
        return visits, distance, gaps, not visits and any(item[2] <= radius for item in measured)
    module.qualifying_visits = operational_visits


def main():
    root = Path(os.environ.get('OPSBOT_DIR', Path.home() / '.openclaw/workspace/opsbot'))
    sys.path.insert(0, str(root / 'scripts'))
    spec = importlib.util.spec_from_file_location('opsbot_visit_matcher', root / 'scripts/match_linxup_appointment_visits.py')
    module = importlib.util.module_from_spec(spec)
    source = appointment_day_policy(Path(spec.origin).read_text())
    exec(compile(source, spec.origin, "exec"), module.__dict__)
    configure_visit_pins(module)
    module.DEFAULT_MIN_DWELL_MINUTES = 0
    module.DEFAULT_MIN_INSIDE_POINTS = 1
    return module.main()


if __name__ == '__main__':
    raise SystemExit(main())
