#!/usr/bin/env python3
"""Synthetic installed-matcher integration: every input/output is temporary or mocked."""
import contextlib
import io
import importlib.util
import json
import runpy
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

loaded=runpy.run_path(str(Path(__file__).with_name('test-linxup-instant-arrivals.py')))
matcher, policy = loaded['matcher'], loaded['policy']
with tempfile.TemporaryDirectory() as directory:
    data=Path(directory)
    matcher.DATA=matcher.LINXUP_HISTORY=data
    matcher.GEOCODE_CACHE_PATH=data/'geocodes.json'
    matcher.GEOCODE_CACHE_PATH.write_text(json.dumps({'addresses':{}}))
    matcher.VISIT_HISTORY=data/'visits'
    jobs=[{'appt_id':'101','job_id':'JK1000001','address':'123 Synthetic Blvd 26-107, Covington LA 70433','truck':'Truck 3','job_status':'Confirmed'}]
    fallback={'location':{'latitude':30.,'longitude':-90.},'source':'Synthetic parish','matchedAddress':'123 Synthetic Blvd','detail':'Building entrance; unit unverified','stale':False}
    fallbacks={jobs[0]['address']:fallback}
    matcher.appointment_source=lambda target:jobs
    output={}
    matcher.write_json=lambda path,payload:output.update(payload)
    matcher.write_csv=lambda path,rows:None
    cutoff=datetime(2026,9,8,15,0,tzinfo=timezone.utc)
    policy.configure_visit_pins(matcher,lambda addresses:fallbacks,lambda:cutoff)
    def point(minute,lat=30.,stamp=None):
        return {'timestamp':stamp or f'2026-09-08T15:{minute:02d}:00Z','latitude':lat,'longitude':-90.,'truck_number':'Truck 3'}
    def run(points):
        (data/'linxup_location_2026-09-08.json').write_text(json.dumps({'points':points}))
        sys.argv=['matcher','--date','2026-09-08']
        with contextlib.redirect_stdout(io.StringIO()):matcher.main()
        return output['visits']
    initial=matcher.GEOCODE_CACHE_PATH.read_bytes()
    arrival=run([point(1),point(2)])[0]
    assert arrival['visit_count']==1 and arrival['final_departure'] is None
    assert arrival['visit_pin']['approximate'] and arrival['match_status']=='approximate_pin'
    assert arrival['visit_pin']['matchedAddress']==fallback['matchedAddress']
    samples=[point(1),point(2),point(6,30.01),point(7,30.01)]
    closed=run(samples)[0]
    assert closed['first_arrival']==point(1)['timestamp'] and closed['final_departure']==point(2)['timestamp']
    matcher.VISIT_HISTORY.mkdir()
    saved_file=matcher.VISIT_HISTORY/'linxup_appointment_visits_2026-09-08.json'
    saved_file.write_text(json.dumps(output))
    spec=importlib.util.spec_from_file_location('synthetic_validator',loaded['root']/'scripts/validate_linxup_appointment_visits.py')
    validator=importlib.util.module_from_spec(spec);spec.loader.exec_module(validator)
    validator.VISIT_HISTORY=matcher.VISIT_HISTORY
    assert validator.validate(date(2026,9,8))['verification_status']=='passed'
    fallbacks[jobs[0]['address']]={**fallback,'location':{'latitude':31.,'longitude':-90.}}
    assert closed==run(samples)[0], 'Existing approximate visit pins survive cache refresh'
    fallbacks[jobs[0]['address']]=fallback
    saved_file.unlink()
    assert closed==run(samples+samples)[0], 'Duplicate GPS deliveries are idempotent'
    assert closed==run(list(reversed(samples)))[0], 'Input ordering is irrelevant'
    assert run([point(1),point(6,30.01),point(6,30.01)])[0]['final_departure'] is None
    assert run([point(1),point(6,30.003),point(7,30.003)])[0]['final_departure'] is None, '400m exit buffer'
    assert run([point(1),point(6,30.01),point(15,30.01)])[0]['final_departure'] is None, 'Sparse GPS cannot corroborate exit'
    assert run([point(1),point(6,30.01),point(6),point(7,30.01)])[0]['final_departure'] is None, 'Conflicting same-stamp GPS cannot corroborate exit'
    single=run([point(1),point(6,30.01),point(7,30.01)])[0]
    assert single['final_departure']==single['first_arrival'] and single['onsite_minutes']==0
    assert run([point(1,stamp='2099-09-08T15:01:00Z')])[0]['visit_count']==0
    assert run([point(1,stamp='2026-09-08T14:59:00Z')])[0]['visit_count']==0, 'No pre-activation replay'
    returned=run(samples+[point(15),point(16),point(20,30.01),point(21,30.01)])[0]
    assert returned['visit_count']==2 and returned['onsite_minutes']==2
    neighbor={**jobs[0],'appt_id':'102','address':'125 Synthetic Blvd, Covington LA 70433','job_status':'Completed'}
    jobs.append(neighbor);fallbacks[neighbor['address']]={**fallback,'location':{'latitude':30.003,'longitude':-90.}}
    assert all(row['visit_count']==0 for row in run(samples)), 'Overlapping approximate pins including completed stops block both'
    pins={matcher.address_hash(matcher.normalize_address(neighbor['address'])):{'latitude':30.003,'longitude':-90.,'match_confidence':'confirmed'}}
    matcher.GEOCODE_CACHE_PATH.write_text(json.dumps({'addresses':pins}))
    assert all(row['visit_count']==0 for row in run(samples)), 'Mixed verified/approximate ambiguity blocks both'
    jobs.pop();matcher.GEOCODE_CACHE_PATH.write_bytes(initial)
    assert run(samples)[0]['visit_count']==1
    jobs[0]['job_status']='Canceled'
    assert run(samples)[0]['visit_count']==0
    jobs[0]['job_status']='Confirmed'
    fallbacks[jobs[0]['address']]={**fallback,'location':{'latitude':None,'longitude':-90}}
    assert run(samples)[0]['visit_count']==0
    fallbacks[jobs[0]['address']]=fallback
    assert matcher.GEOCODE_CACHE_PATH.read_bytes()==initial, 'Never promote approximate geocodes'
    assert jobs[0]['truck']=='Truck 3' and jobs[0]['job_status']=='Confirmed'
    # Exercise the actual durable cutoff helper only against a temporary root.
    start=policy.approximate_policy_start(data)
    assert start==policy.approximate_policy_start(data)
    (data/'config/approximate-visit-policy.json').write_text('{}')
    try:policy.approximate_policy_start(data);raise AssertionError('Corruption must fail closed')
    except (KeyError,ValueError):pass
print('PASS approximate matcher: arrivals, departures, duplicates/reorder, return visits, overlap, future/stale/sparse GPS, cancellation, invalid pins, prospective cutover, no verification promotion; no live writes/network.')
