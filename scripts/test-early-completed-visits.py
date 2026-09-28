"""Synthetic regression for retrospective completed-visit attribution."""
import importlib.util
import json
import tempfile
import unittest
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

spec = importlib.util.spec_from_file_location('early', Path(__file__).parent/'runtime/early_completed_visits.py')
early = importlib.util.module_from_spec(spec)
spec.loader.exec_module(early)

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.day = date(2026, 9, 8)
        self.job = {'_appointment_id':'job','job_status':'Completed Duration: 60 min(s)',
                    'appointment_time':'3 PM - 4 PM','address':'100 Example St','_trucks':['Truck 3']}
        self.jobs = [self.job]
        self.row = {'appointment_id':'job','truck_number':'Truck 3','match_confidence':'no_visit_detected','visit_intervals':[]}
        self.visit = {'arrival':'2026-09-08T15:23:42Z','departure':'2026-09-08T15:46:06Z',
                      'departure_confirmed':True,'onsite_minutes':22.4,'inside_point_count':24,
                      'source_timestamps':['2026-09-08T15:23:42Z','2026-09-08T15:46:06Z']}
        self.visits = {'Truck 3':[self.visit]}
        self.pins = {'100 Example St':{'match_confidence':'confirmed','house_street_verified':True,'latitude':30.2,'longitude':-90.9}}
        self.points = [{'truck_number':'Truck 3','timestamp':'2026-09-08T15:24:00Z'}]
        parse = lambda value: datetime.fromisoformat(value.replace('Z','+00:00')) if value else None
        self.calls = 0
        def qualify(points, lat, lon, radius, dwell, count, grace):
            self.assertEqual((dwell,count),(5,3))
            self.calls += 1
            return self.visits.get(points[0]['truck_number'],[]),10,[],False
        self.matcher = SimpleNamespace(deduplicate_appointments=lambda rows,target:rows,
            appointment_source=lambda target:self.jobs,parse_window=lambda target,text:(parse('2026-09-08T20:00:00Z'),parse('2026-09-08T21:00:00Z')),
            GEOCODE_CACHE_PATH=root/'pins.json',LINXUP_HISTORY=root,normalize_address=lambda a:a,address_hash=lambda a:a,
            normalize_truck=lambda t:t,parse_timestamp=parse,LOCAL_TZ=ZoneInfo('America/Chicago'),
            mappings_for_date=lambda target:[SimpleNamespace(junkware_truck_number=t,linxup_tracker_id=t) for t in ('Truck 3','Truck 4')],
            DEFAULT_RADIUS_METERS=200,DEFAULT_DEPARTURE_GRACE_MINUTES=5,DEFAULT_MAX_VISIT_MINUTES=720,
            haversine_meters=lambda a,b,c,d:0 if (a,b)==(c,d) else 1000,
            qualifying_visits=qualify,interval_metrics=lambda intervals:{'elapsed_site_coverage_minutes':22.4})

    def run_recovery(self, rows=None):
        self.matcher.GEOCODE_CACHE_PATH.write_text(json.dumps({'addresses':self.pins}))
        (self.matcher.LINXUP_HISTORY/'linxup_location_2026-09-08.json').write_text(json.dumps({'points':self.points}))
        return early.recover_early_completed_visits(self.matcher,rows or [self.row],self.day)

    def test_recovers_early_visit_without_changing_source(self):
        original = deepcopy((self.job,self.row))
        result = self.run_recovery()[0]
        self.assertEqual(result['first_arrival'],self.visit['arrival'])
        self.assertEqual(result['onsite_minutes'],22.4)
        self.assertEqual(result['match_confidence'],'confirmed')
        self.assertEqual((self.job,self.row),original)
        self.assertEqual(self.run_recovery([result]),[result], 'Already recovered evidence is stable')

    def test_open_canceled_ambiguous_and_existing_visits_stay_unchanged(self):
        for status in ['Confirmed','Canceled','Completed canceled']:
            self.job['job_status']=status
            self.assertEqual(self.run_recovery(),[self.row])
        self.job['job_status']='Completed'
        for confidence in ['ambiguous','probable','confirmed']:
            self.row['match_confidence']=confidence
            self.assertEqual(self.run_recovery(),[self.row])
        self.assertEqual(self.calls,0)

    def test_requires_verified_location_and_explicit_identity(self):
        self.pins['100 Example St']['house_street_verified']=False
        self.assertEqual(self.run_recovery(),[self.row])
        self.pins['100 Example St']['house_street_verified']=True
        self.job['_appointment_id']='derived-123'
        self.assertEqual(self.run_recovery(),[self.row])

    def test_short_unfinished_gapped_and_late_visits_are_not_recovered(self):
        for patch in [{'onsite_minutes':1},{'departure':None},{'departure_confirmed':False},
                      {'boundary_coverage_gaps':[{}]},{'departure':'2026-09-08T21:30:00Z'}]:
            self.visits['Truck 3']=[{**self.visit,**patch}]
            self.assertEqual(self.run_recovery(),[self.row])

    def test_multiple_trucks_or_competing_premises_are_ambiguous(self):
        self.points.append({**self.points[0],'truck_number':'Truck 4'})
        self.visits['Truck 4']=[self.visit]
        self.assertEqual(self.run_recovery(),[self.row])
        self.points.pop()
        self.jobs.append({**self.job,'_appointment_id':'other'})
        self.assertEqual(self.run_recovery(),[self.row])

    def test_other_owner_blocks_even_partial_overlap(self):
        other = {**self.row,'appointment_id':'other','match_confidence':'confirmed',
                 'visit_intervals':[{'arrival':'2026-09-08T15:30:00Z','departure':'2026-09-08T15:50:00Z'}]}
        self.assertEqual(self.run_recovery([self.row,other]),[self.row,other])

    def test_previous_day_gps_does_not_qualify(self):
        self.points[0]['timestamp']='2026-09-08T04:59:00Z'
        self.assertEqual(self.run_recovery(),[self.row])
        self.assertEqual(self.calls,0)

if __name__=='__main__':
    unittest.main()
