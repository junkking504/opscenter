"""Recover visits from exact-address native stops, without inventing map pins.

Runs on already collected data. Stop labels establish the premises; independent
timestamped positions establish dwell and departure. No provider calls or writes.
"""
from datetime import datetime, timedelta, timezone
import math
import re

ALIASES = dict(STREET="ST", ROAD="RD", AVENUE="AVE", DRIVE="DR", LANE="LN",
               COURT="CT", BOULEVARD="BLVD", HIGHWAY="HWY", PLACE="PL",
               PARKWAY="PKWY", TERRACE="TER", CIRCLE="CIR", TRAIL="TRL",
               NORTH="N", SOUTH="S", EAST="E", WEST="W", LOUISIANA="LA")
ROAD = r"(?:STREET|ST|ROAD|RD|AVENUE|AVE|DRIVE|DR|LANE|LN|COURT|CT|BOULEVARD|BLVD|HIGHWAY|HWY|PLACE|PL|PARKWAY|PKWY|TERRACE|TER|CIRCLE|CIR|TRAIL|TRL|WAY)"


def address_identity(value):
    value = re.sub(r"\s+", " ", str(value or "")).strip().upper()
    value = re.sub(r"(\b\d{5}(?:-\d{4})?)(?:\s+(?:(?:(?:CCR|DRIVER|OFFICE)\s+)?FOLLOW[ -]?UP|SMS|MORE DETAILS)\.?)+$", r"\1", value)
    # Unit-specific premises cannot be resolved by a street-only GPS label.
    if re.search(r"\b(?:APT|APARTMENT|UNIT|STE|SUITE|BLDG|BUILDING|FLOOR|FL)\b|#", value):
        return None
    candidates = list(re.finditer(r"\b\d+[A-Z]?\s+(?:[A-Z][A-Z.'’-]*\s+){0,8}?" + ROAD + r"\b", value))
    if len(candidates) != 1:
        return None
    street = candidates[0]
    # Numeric business labels are okay only when the digit is part of a word.
    if re.search(r"\b\d+\b", value[:street.start()]):
        return None
    tail = re.fullmatch(r"[,\s]+([A-Z][A-Z .'-]*?)(?:,?\s+(?:LA|LOUISIANA))?[,\s]+(70\d{3})(?:-\d{4})?", value[street.end():])
    if not tail:
        return None
    def normalize(text):
        return " ".join(ALIASES.get(t, t) for t in re.findall(r"[A-Z0-9]+", text))
    return normalize(street.group()), normalize(tail[1]), tail[2]


def point_valid(row):
    try:
        if any(not isinstance(row[key], (int, float)) or isinstance(row[key], bool) for key in ('latitude', 'longitude')):
            return False
        lat, lon = float(row['latitude']), float(row['longitude'])
        return math.isfinite(lat) and math.isfinite(lon) and 29 <= lat <= 31.3 and -93 <= lon <= -89.4
    except (KeyError, ValueError, TypeError):
        return False


def recover_stop_visits(payload, appointments, gps, matcher, now=None):
    """Mutate only unresolved assigned rows; preserve every existing confirmed row."""
    def parse(value):
        try:
            return matcher.parse_timestamp(value)
        except (ValueError, TypeError, OverflowError, OSError):
            return None
    now = now or datetime.now(timezone.utc)
    target = matcher.date.fromisoformat(payload['date'])
    mappings = {m.junkware_truck_number: m.linxup_tracker_id for m in matcher.mappings_for_date(target)}
    params = payload['parameters']
    windows = {}
    for job in appointments:
        start, end = matcher.parse_window(target, job.get('appointment_time', ''))
        identity = address_identity(job.get('address'))
        if start and end and identity:
            windows[job['_appointment_id']] = (identity,
                start - timedelta(minutes=params['appointment_search_window_before_minutes']),
                end + timedelta(minutes=params['appointment_search_window_after_minutes']), job)
    changed = set()
    for row in payload['visits']:
        if row.get('match_reason') != 'missing_or_ambiguous_geocode' or row.get('visit_intervals'):
            continue
        context = windows.get(row['appointment_id'])
        truck = row.get('truck_number')
        tracker = mappings.get(truck)
        if not context or not tracker or tracker != row.get('tracker_id'):
            continue
        identity, start, end, job = context
        if job.get('_trucks') != [truck] or re.search(r'cancel', str(job.get('job_status', '')), re.I):
            continue
        stops = []
        for stop in gps.get('stops', []):
            if stop.get('deviceUUID') != tracker or stop.get('stateCode') != 'LA' or stop.get('countryCode') not in ('USA', 'US'):
                continue
            if stop.get('stopType') not in ('Engine Off', 'Idling') or not point_valid(stop):
                continue
            if address_identity(f"{stop.get('street', '')}, {stop.get('city', '')}, LA {stop.get('postalCode', '')}") != identity:
                continue
            begin, finish = parse(stop.get('beginDate')), parse(stop.get('endDate'))
            if not begin or not finish or not start <= begin < finish <= min(end, now) or finish - begin > timedelta(hours=12):
                continue
            # Reject a stop that could belong to another appointment at the same
            # premises in an overlapping search window, including completed jobs.
            owners = [j['_appointment_id'] for key, a, b, j in windows.values()
                      if key == identity and truck in j.get('_trucks', []) and a <= begin <= b]
            if owners != [row['appointment_id']]:
                continue
            stops.append((begin, finish, stop))
        if not stops:
            continue
        stops.sort(key=lambda s: s[0])
        origin = stops[0][2]
        distance = matcher.haversine_meters
        if any(distance(origin['latitude'], origin['longitude'], s['latitude'], s['longitude']) > 75 for _, _, s in stops):
            continue
        # Adjacent engine-off and idling phases form one stationary stop.
        spans = []
        for begin, finish, _ in stops:
            if spans and begin <= spans[-1][1] + timedelta(seconds=1):
                spans[-1][1] = max(finish, spans[-1][1])
            else:
                spans.append([begin, finish])
        spans = [(a, b) for a, b in spans if b - a >= timedelta(minutes=5)]
        if not spans:
            continue
        points = [p for p in gps.get('points', []) if p.get('tracker_id') == tracker
                  and matcher.normalize_truck(p.get('truck_number')) == truck and point_valid(p)
                  and (stamp := parse(p.get('timestamp'))) and start <= stamp <= min(end, now)]
        spans = [(a, b) for a, b in spans if len({p['timestamp'] for p in points
                 if a <= parse(p['timestamp']) <= b
                 and isinstance(p.get('speed'), (int, float)) and 0 <= p['speed'] <= 3
                 and distance(origin['latitude'], origin['longitude'], p['latitude'], p['longitude']) <= 75}) >= 3]
        if not spans:
            continue
        # Retain the stronger dwell requirement for address recovery even where
        # verified geofences permit immediate single-point arrivals.
        visits, nearest, gaps, _ = matcher.qualifying_visits(points, origin['latitude'], origin['longitude'],
                                                           min(125, params['geofence_radius_meters']), 5, 3,
                                                           params['departure_grace_period_minutes'])
        visits = [v for v in visits if not v.get('boundary_coverage_gaps') and any(
            parse(v['arrival']) <= b and
            max(parse(t) for t in v['source_timestamps']) >= a
            for a, b in spans)]
        if not visits or any(v['onsite_minutes'] > params['maximum_plausible_visit_duration_minutes'] for v in visits):
            continue
        total = round(sum(v['onsite_minutes'] for v in visits), 2)
        row.update(first_arrival=visits[0]['arrival'], arrival_at=visits[0]['arrival'],
                   final_departure=visits[-1]['departure'], departure_at=visits[-1]['departure'],
                   duration_minutes=total, onsite_minutes=total, visit_count=len(visits), visit_intervals=visits,
                   match_confidence='confirmed', match_status='verified', match_reason='exact_address_native_stop_with_gps_dwell',
                   gps_coverage_quality='good', gps_coverage_gaps=gaps, pass_by_only=False,
                   minimum_distance_to_appointment=round(nearest, 2),
                   source_timestamps=[t for v in visits for t in v['source_timestamps']],
                   matched_gps_point_count=sum(v['inside_point_count'] for v in visits),
                   location_evidence={'source': 'LinxUp native stop address', 'address_identity': list(identity),
                                      'latitude': origin['latitude'], 'longitude': origin['longitude'],
                                      'tracker_id': tracker, 'stop_intervals': [
                                          {'arrival': matcher.iso_utc(a), 'departure': matcher.iso_utc(b)} for a, b in spans]})
        changed.add(row['appointment_id'])
    for appointment_id in changed:
        rows = [r for r in payload['visits'] if r['appointment_id'] == appointment_id]
        confirmed = [r for r in rows if r.get('match_confidence') == 'confirmed']
        intervals = [(parse(v['arrival']), parse(v['departure']))
                     for r in confirmed for v in r['visit_intervals'] if v.get('departure_confirmed') and v.get('departure')]
        metrics = matcher.interval_metrics(intervals)
        metrics['truck_count'] = len({r['truck_number'] for r in confirmed})
        for row in rows:
            row.update(metrics)
    return len(changed)
