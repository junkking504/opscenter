#!/usr/bin/env python3
"""Installed matcher integration; inputs and writes are temporary/mocked only."""
import contextlib
import io
import json
import runpy
import sys
import tempfile
from pathlib import Path

loaded = runpy.run_path(str(Path(__file__).with_name('test-linxup-instant-arrivals.py')))
matcher, policy = loaded['matcher'], loaded['policy']
with tempfile.TemporaryDirectory() as directory:
    data = Path(directory)
    matcher.DATA = matcher.LINXUP_HISTORY = data
    matcher.GEOCODE_CACHE_PATH = data / 'geocodes.json'
    matcher.GEOCODE_CACHE_PATH.write_text(json.dumps({'addresses': {}}))
    matcher.VISIT_HISTORY = data / 'visits'
    matcher.VISIT_HISTORY.mkdir()
    address = '123 Synthetic Rd Lot 54 Hammond, LA 70403'
    jobs = [{'appt_id': '101', 'job_id': 'JK_TEST', 'address': address, 'truck': 'Truck 3', 'job_status': 'Confirmed'}]
    fallback = {'location': {'latitude': 30., 'longitude': -90.}, 'sourceAddress': address,
                'source': 'Synthetic parish', 'matchedAddress': '123 Synthetic Rd Unit 54',
                'detail': 'Unit entrance unverified', 'stale': False, 'approximate': True}
    matcher.appointment_source = lambda target: jobs
    output = {}
    matcher.write_json = lambda path, payload: output.update(payload)
    matcher.write_csv = lambda path, rows: None
    fallback_reads = []
    policy.configure_visit_pins(matcher, lambda addresses: fallback_reads.append(addresses) or {address: fallback})
    def point(minute, lat=30.):
        return {'timestamp': f'2026-09-08T15:{minute:02d}:00Z', 'latitude': lat,
                'longitude': -90., 'truck_number': 'Truck 3'}
    def run(points):
        (data / 'linxup_location_2026-09-08.json').write_text(json.dumps({'points': points}))
        sys.argv = ['matcher', '--date', '2026-09-08']
        with contextlib.redirect_stdout(io.StringIO()):
            matcher.main()
        return output['visits'][0]
    samples = [point(1), point(2), point(6, 30.01), point(7, 30.01)]
    original = matcher.GEOCODE_CACHE_PATH.read_bytes()
    for fields in [{}, {'visitEligible': False}, {'navigationReviewed': True, 'visitEligible': False}]:
        fallback.update(fields)
        row = run(samples)
        assert row['visit_count'] == 0 and row['final_departure'] is None
    saved_file = matcher.VISIT_HISTORY / 'linxup_appointment_visits_2026-09-08.json'
    saved_file.write_text(json.dumps({'visits': [{'appointment_id': '101', 'match_confidence': 'confirmed',
        'visit_count': 1, 'visit_pin': fallback, 'first_arrival': point(1)['timestamp'], 'final_departure': None}]}))
    historical = saved_file.read_bytes()
    assert run(samples)['visit_count'] == 0, 'Retained approximate evidence cannot bypass the exclusion'
    assert saved_file.read_bytes() == historical, 'Historical input remains untouched'
    assert matcher.GEOCODE_CACHE_PATH.read_bytes() == original
    assert fallback_reads == [], 'No fallback lookup is needed for GPS matching'
    assert not (data / 'config/approximate-visit-policy.json').exists(), 'Do not create/reset old activation state'
    key = matcher.address_hash(matcher.normalize_address(address))
    verified = {'latitude': 30., 'longitude': -90., 'match_confidence': 'confirmed'}
    matcher.GEOCODE_CACHE_PATH.write_text(json.dumps({'addresses': {key: verified}}))
    row = run(samples)
    assert row['visit_count'] == 1 and row['first_arrival'] == point(1)['timestamp']
    assert row['final_departure'] == point(2)['timestamp'], 'Exact GPS arrival/departure behavior remains'
    verified['visit_pin'] = fallback
    matcher.GEOCODE_CACHE_PATH.write_text(json.dumps({'addresses': {key: verified}}))
    assert run(samples)['visit_count'] == 0, 'Approximate metadata cannot masquerade as a verified pin'
    assert jobs[0]['address'] == address and jobs[0]['truck'] == 'Truck 3'
print('PASS GPS policy: ordinary/reviewed/persisted approximate pins excluded; exact arrivals/departures preserved; no live writes/network.')
