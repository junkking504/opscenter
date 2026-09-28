#!/usr/bin/env python3
"""Exercise the installed matcher with synthetic data and all writers disabled."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace

root = Path(os.environ.get('OPSBOT_DIR', Path.home() / '.openclaw/workspace/opsbot'))
sys.path.insert(0, str(root / 'scripts'))
# This test needs no geocoder, secrets or network. Identity is exact synthetic text.
geocoder = ModuleType('geocode_junkware_appointments')
geocoder.normalize_address = lambda value: value.strip().upper()
geocoder.address_hash = lambda value: hashlib.sha256(value.encode()).hexdigest()
sys.modules['geocode_junkware_appointments'] = geocoder
spec = importlib.util.spec_from_file_location('policy', Path(__file__).with_name('match-linxup-instant-arrivals.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
source_path = root/'scripts/match_linxup_appointment_visits.py'
spec = importlib.util.spec_from_file_location('matcher', source_path)
matcher = importlib.util.module_from_spec(spec)
exec(compile(policy.appointment_day_policy(source_path.read_text()),str(source_path),'exec'),matcher.__dict__)

point = {'timestamp':'2026-09-08T15:23:42Z','latitude':30.0,'longitude':-90.0,'truck_number':'Truck 3'}
with tempfile.TemporaryDirectory() as directory:
    data = Path(directory)
    matcher.GEOCODE_CACHE_PATH=data/'pins.json'
    matcher.GEOCODE_CACHE_PATH.write_text(json.dumps({'addresses':{geocoder.address_hash('100 EXAMPLE ST'):{'latitude':30,'longitude':-90,'match_confidence':'confirmed'}}}))
    matcher.LINXUP_HISTORY=data
    matcher.DATA=data
    matcher.mappings_for_date=lambda target:[SimpleNamespace(junkware_truck_number='Truck 3',linxup_tracker_id='synthetic')]
    source_job={'appt_id':'job','job_id':'JK_TEST','address':'100 Example St','truck':'Truck 3','appointment_time':'03:00 PM - 04:00 PM','job_status':'Confirmed'}
    matcher.appointment_source=lambda target:[source_job]
    captured={}
    matcher.write_json=lambda path,payload:captured.update(payload)
    matcher.write_csv=lambda path,rows:None
    def run(points):
        (data/'linxup_location_2026-09-08.json').write_text(json.dumps({'points':points}))
        # These legacy knobs must no longer impose limits on physical presence.
        sys.argv=['matcher','--date','2026-09-08','--before-minutes','0','--after-minutes','0','--minimum-dwell-minutes','99','--minimum-inside-points','99','--maximum-visit-minutes','1']
        with contextlib.redirect_stdout(io.StringIO()): matcher.main()
        return captured['visits'][0]
    for stamp in ['2026-09-08T05:01:00Z','2026-09-08T15:23:42Z','2026-09-09T04:59:00Z']:
        row=run([{**point,'timestamp':stamp}])
        assert row['match_confidence']=='confirmed', (stamp,row)
        assert row['visit_count']==1 and row['first_arrival']==stamp
        assert row['final_departure'] is None and row['onsite_minutes']==0
    assert captured['parameters']['appointment_search_scope']=='entire_operating_day'
    assert captured['parameters']['maximum_plausible_visit_duration_minutes'] is None
    assert captured['parameters']['minimum_qualifying_dwell_minutes']==0
    assert captured['parameters']['minimum_consecutive_inside_points']==1
    for stamp in ['2026-09-08T04:59:00Z','2026-09-09T05:00:00Z']:
        assert run([{**point,'timestamp':stamp}])['visit_count']==0, 'Keep separate operating dates separate'
    assert run([{**point,'latitude':31}])['visit_count']==0, 'Outside premises is not a visit'
    start=datetime(2026,9,8,5,1,tzinfo=timezone.utc)
    long_visit=[{**point,'timestamp':(start+timedelta(minutes=i)).isoformat().replace('+00:00','Z')} for i in range(0,14*60+1,5)]
    row=run(long_visit)
    assert row['match_confidence']=='confirmed' and row['onsite_minutes']==840, 'No maximum duration cutoff'
    assert source_job['appointment_time']=='03:00 PM - 04:00 PM' and source_job['job_status']=='Confirmed'
    row=run([point,{**point,'timestamp':'2026-09-08T15:24:00Z','latitude':31},{**point,'timestamp':'2026-09-08T15:30:00Z','latitude':31}])
    assert row['visit_count']==1 and row['final_departure']==point['timestamp'], 'Single-point visit survives a confirmed departure'
    assert row['onsite_minutes']==0, 'Do not invent time onsite'
try:
    policy.appointment_day_policy('unreviewed collector shape')
    raise AssertionError('Incompatible collector must stop')
except RuntimeError:
    pass
print('Installed collector passed: early/late/single-point visits, no minimum or maximum, operating-day isolation, source preservation, no invented duration and no writes/network.')
