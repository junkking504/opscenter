#!/usr/bin/env python3
"""Installed collector: same geometry yields same operations for either pin label."""
import contextlib
import io
import json
import runpy
import sys
import tempfile
from datetime import datetime, timezone
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
    jobs = [{'appt_id':'101','job_id':'JK_TEST','address':address,'truck':'Truck 3','job_status':'Confirmed'}]
    pin = {'location':{'latitude':30.,'longitude':-90.},'sourceAddress':address,
           'source':'Synthetic parish','matchedAddress':'123 Synthetic Rd Unit 54',
           'detail':'Unit entrance unverified','stale':False,'approximate':True}
    pins = {address:pin}
    matcher.appointment_source = lambda target: jobs
    output = {}
    matcher.write_json = lambda path, payload: output.update(payload)
    matcher.write_csv = lambda path, rows: None
    start = lambda: datetime(2026,1,1,tzinfo=timezone.utc)
    policy.configure_visit_pins(matcher, lambda addresses: pins, start)
    def point(minute,lat=30.):
        return {'timestamp':f'2026-09-08T15:{minute:02d}:00Z','latitude':lat,'longitude':-90.,'truck_number':'Truck 3'}
    def run(points):
        (data/'linxup_location_2026-09-08.json').write_text(json.dumps({'points':points}))
        sys.argv=['matcher','--date','2026-09-08']
        with contextlib.redirect_stdout(io.StringIO()): matcher.main()
        return output['visits']
    samples=[point(1),point(2),point(6,30.01),point(7,30.01)]
    original=matcher.GEOCODE_CACHE_PATH.read_bytes()
    decisions=[]
    for approximate in [False,True]:
        for fields in [{},{'visitEligible':False},{'navigationReviewed':True,'visitEligible':False}]:
            pin.update(fields,approximate=approximate)
            row=run(samples)[0]
            assert row['visit_count']==1 and row['first_arrival']==point(1)['timestamp']
            decisions.append({key:row[key] for key in ['visit_count','first_arrival','final_departure','onsite_minutes','visit_intervals','matched_gps_point_count']})
    assert all(value==decisions[0] for value in decisions), 'Labels cannot change arrivals, departures or duration'
    assert decisions[0]['final_departure']==point(2)['timestamp']
    assert run([point(1,30.01)])[0]['visit_count']==0, 'Actual distance still matters'
    for approximate in [False,True]:
        pin['approximate']=approximate
        duplicate_exit=[point(1),point(6,30.01),point(6,30.01)]
        assert run(duplicate_exit)[0]['final_departure'] is None, 'Repeated copies are not two outside observations'
        assert run([point(1),point(6,30.01),point(12,30.01)])[0]['final_departure'] is None, 'Uncovered gaps cannot establish departure'
        conflicting=[{**point(1),'delivery_source':'v3_position_push'},
                     {**point(1,30.01),'delivery_source':'v2_poll'},point(6,30.01),point(7,30.01)]
        assert run(conflicting)[0]['first_arrival']==point(1)['timestamp'], 'Push authority wins over rounded poll conflicts'
        assert run([point(1),point(1,30.01)])[0]['visit_count']==0, 'Same-authority conflict cannot establish an arrival'
    # Overlapping appointments have the same ambiguity guard for every label.
    for approximate in [False,True]:
        pin['approximate']=approximate
        neighbor_address='125 Synthetic Rd Hammond, LA 70403'
        jobs.append({**jobs[0],'appt_id':'102','address':neighbor_address})
        pins[neighbor_address]={**pin,'sourceAddress':neighbor_address,'location':{'latitude':30.001,'longitude':-90.}}
        assert all(row['visit_count']==0 for row in run(samples))
        jobs.pop();pins.pop(neighbor_address)
    saved=matcher.VISIT_HISTORY/'linxup_appointment_visits_2026-09-08.json'
    saved.write_text(json.dumps({'visits':[{'appointment_id':'101','visit_pin':pin}]}))
    before=saved.read_bytes()
    pins[address]=None
    assert run(samples)[0]['visit_count']==0, 'Missing current coordinate cannot revive historical metadata'
    pins[address]={**pin,'sourceAddress':'different service address'}
    assert run(samples)[0]['visit_count']==0, 'Source identity must agree'
    pins[address]={**pin,'location':{'latitude':float('nan'),'longitude':-90.}}
    assert run(samples)[0]['visit_count']==0, 'Invalid coordinate is not a visit'
    cutoff_address='124 Synthetic Rd Hammond, LA 70403'
    jobs[0]['address']=cutoff_address
    pins[cutoff_address]={**pin,'sourceAddress':cutoff_address}
    policy.configure_visit_pins(matcher,lambda addresses:pins,lambda:datetime(2026,9,8,15,4,tzinfo=timezone.utc))
    assert run(samples)[0]['visit_count']==0, 'Rollout cannot replay formerly ignored GPS'
    assert run([point(5)])[0]['visit_count']==1
    pins[cutoff_address].update(approximate=False,sourceKind='verified_location')
    assert run(samples)[0]['visit_count']==0, 'Later verification cannot erase the prospective cutoff and replay old arrivals'
    assert run([point(5)])[0]['visit_count']==1
    jobs[0]['address']=address
    assert saved.read_bytes()==before and matcher.GEOCODE_CACHE_PATH.read_bytes()==original
    assert jobs[0]['address']==address and jobs[0]['truck']=='Truck 3'
    # Activation is durable and never resets after restart.
    first=policy.approximate_policy_start(data)
    assert policy.approximate_policy_start(data)==first
    (data/'config/operational-map-pin-policy.json').write_text('{bad')
    try:
        policy.approximate_policy_start(data)
        raise AssertionError('Corrupt cutoff must fail closed')
    except json.JSONDecodeError:
        pass
print('PASS label-independent collector: parity, radius, overlap, identity, invalid coordinates, prospective rollout, source preservation; synthetic writes only.')
