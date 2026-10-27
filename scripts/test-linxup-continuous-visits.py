#!/usr/bin/env python3
"""Synthetic visit continuity regressions; no collector run, network or live writes."""
import copy
import hashlib
import importlib.util
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType

sys.dont_write_bytecode = True
root = Path(os.environ.get('OPSBOT_DIR', Path.home() / '.openclaw/workspace/opsbot'))
sys.path.insert(0, str(root / 'scripts'))
geocoder = ModuleType('geocode_junkware_appointments')
geocoder.normalize_address = lambda value: value.strip().upper()
geocoder.address_hash = lambda value: hashlib.sha256(value.encode()).hexdigest()
sys.modules['geocode_junkware_appointments'] = geocoder
policy_path = Path(os.environ.get('VISIT_POLICY_UNDER_TEST', Path(__file__).with_name('match-linxup-instant-arrivals.py')))
spec = importlib.util.spec_from_file_location('policy', policy_path)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
matcher = ModuleType('synthetic_matcher')
source = root / 'scripts/match_linxup_appointment_visits.py'
exec(compile(policy.appointment_day_policy(source.read_text()), str(source), 'exec'), matcher.__dict__)
policy.configure_visit_pins(matcher, lambda addresses: {})

start = datetime(2026, 1, 8, 15, tzinfo=timezone.utc)


def point(minutes, latitude=30, longitude=-90, **extra):
    return {'timestamp': matcher.iso_utc(start + timedelta(minutes=minutes)),
            'latitude': latitude, 'longitude': longitude, 'speed': 0, 'ignition': 'OFF', **extra}


def visits(points, lat=30, lon=-90):
    before = copy.deepcopy(points)
    result = matcher.qualifying_visits(points, lat, lon, 200, 0, 1, 5)
    assert points == before, 'Raw points must remain unchanged'
    return result


# Hourly parked heartbeats and an even longer silent period retain one identity.
rows, _, gaps, _ = visits([point(0), point(60), point(120)])
assert len(rows) == 1, 'A parked heartbeat gap must not create another arrival'
assert rows[0]['arrival'] == point(0)['timestamp'] and rows[0]['departure'] is None
assert rows[0]['onsite_minutes'] == 120 and len(rows[0]['coverage_gaps']) == 2
assert len(gaps) == 2, 'Continuity must not erase missing-coverage evidence'
assert len(visits([point(0), point(240)])[0]) == 1, 'Stale telemetry does not prove departure'

# A short recorded approach, quiet parking, renewed fixes, then corroborated exit.
rows = visits([point(0), point(1), point(2), point(35), point(36), point(40),
               point(41, 30.01), point(42, 30.01), point(45, 30.01)])[0]
assert len(rows) == 1 and rows[0]['onsite_minutes'] == 40
assert rows[0]['departure'] == point(40)['timestamp'] and rows[0]['departure_confirmed']

# Real departure/return remains two visits, including misleading stop metadata.
points = [point(0, continuous_until=point(120)['timestamp']), point(1),
          point(6, 30.01), point(7, 30.01), point(60), point(61)]
rows = visits(points)[0]
assert len(rows) == 2 and rows[0]['departure'] == point(1)['timestamp']
assert rows[1]['arrival'] == point(60)['timestamp'] and rows[1]['departure'] is None
assert sum(row['onsite_minutes'] for row in rows) == 2, 'Time away is not dwell'

# A single noisy point, radius-buffer jitter, duplicates or sparse outside fixes
# cannot manufacture a departure. Real exit requires the existing corroboration.
for away in ([point(6, 30.01)], [point(6, 30.0027), point(7, 30.0027)],
             [point(6, 30.01), point(6, 30.01)], [point(6, 30.01), point(12, 30.01)]):
    rows = visits([point(0), *away, point(60)])[0]
    assert len(rows) == 1 and rows[0]['departure'] is None
rows = visits([point(0), point(6, 30.01), point(7, 30.01)])[0]
assert len(rows) == 1 and rows[0]['departure_confirmed']

# Observation order/repeats cannot change visit identities or inflate dwell.
ordered = [point(0), point(30), point(31), point(36, 30.01), point(37, 30.01), point(60)]
assert visits(list(reversed(ordered)) + ordered)[0] == visits(ordered)[0]
# Prefer authoritative V3 fixes at a repeated timestamp; conflicting equal-
# authority positions remain unusable, rather than proving departure.
assert len(visits([point(0), point(6, 30.01), point(6, delivery_source='v3_position_push'),
                   point(7, 30.01), point(60)])[0]) == 1
assert len(visits([point(0), point(6, 30.01), point(6), point(7, 30.01), point(60)])[0]) == 1
assert len(visits([point(0), point(6, 30.01), point(7), point(7, 30.01),
                   point(8, 30.01), point(60)])[0]) == 1, 'Conflicting fixes interrupt exit corroboration'

# Appointments and truck streams are separate inputs: visiting a distinct site
# closes the first only on its own positive outside evidence, never a shared ID.
two_sites = [point(0), point(1), point(6, 30.01), point(7, 30.01), point(8, 30.01)]
assert visits(two_sites)[0][0]['departure'] == point(1)['timestamp']
assert visits(two_sites, lat=30.01)[0][0]['arrival'] == point(6)['timestamp']
assert visits([point(0), point(60)])[0][0]['departure'] is None
assert visits([point(0, 31), point(60, 31)])[0] == []

# Midnight is not an exit. The main matcher's existing Chicago-date filter still
# isolates daily ledgers (covered end-to-end by test-linxup-instant-arrivals.py).
midnight = [dict(point(0), timestamp='2026-01-09T05:59:00Z'),
            dict(point(1), timestamp='2026-01-09T06:01:00Z')]
rows = visits(midnight)[0]
assert len(rows) == 1 and rows[0]['departure'] is None
assert rows[0]['onsite_minutes'] == 2
print('PASS continuous visits: parked/stale gaps, corroborated exits/returns, jitter, duplicates, order, source priority, separate sites/streams, midnight; no raw mutations or live writes.')
