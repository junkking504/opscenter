import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import sys
sys.path.insert(0,str(Path.home()/'.openclaw/workspace/opsbot/scripts'))
import match_linxup_appointment_visits as matcher
from linxup_stop_visit_recovery import address_identity,recover_stop_visits

start=datetime(2026,9,17,14,tzinfo=timezone.utc)
now=start+timedelta(hours=4)
matcher.mappings_for_date=lambda _: [SimpleNamespace(junkware_truck_number='Truck 4',linxup_tracker_id='synthetic-tracker')]
job={'_appointment_id':'synthetic-job','_trucks':['Truck 4'],'job_id':'JK-TEST','address':'HomeSweetHome1 123 Example Lane Slidell, LA 70461','appointment_time':'09:00 AM - 10:00 AM','job_status':'Completed'}
base={'date':'2026-09-17','parameters':{'appointment_search_window_before_minutes':240,'appointment_search_window_after_minutes':360,'geofence_radius_meters':125,'departure_grace_period_minutes':5,'maximum_plausible_visit_duration_minutes':720},'visits':[{'appointment_id':'synthetic-job','truck_number':'Truck 4','tracker_id':'synthetic-tracker','match_reason':'missing_or_ambiguous_geocode','match_confidence':'ambiguous','visit_intervals':[]}]}
def point(minute,away=False):
 return {'timestamp':matcher.iso_utc(start+timedelta(minutes=minute)),'latitude':30.2+(0.005 if away else 0),'longitude':-89.8,'truck_number':'Truck 4','tracker_id':'synthetic-tracker','speed':20 if away else 0}
def stop(a,b,kind='Engine Off'):
 return {'deviceUUID':'synthetic-tracker','street':'123 Example Ln','city':'Slidell','stateCode':'LA','postalCode':'70461','countryCode':'USA','stopType':kind,'latitude':30.2,'longitude':-89.8,'beginDate':int((start+timedelta(minutes=a)).timestamp()*1000),'endDate':int((start+timedelta(minutes=b)).timestamp()*1000)}
gps={'points':[point(n) for n in range(9)]+[point(n,True) for n in range(9,16)],'stops':[stop(0,3),stop(3,8,'Idling')]}
def run(g=gps,jobs=None,p=None):
 p=copy.deepcopy(p or base);recover_stop_visits(p,copy.deepcopy(jobs or [job]),copy.deepcopy(g),matcher,now);return p['visits'][0]
r=run();assert r['match_confidence']=='confirmed' and r['onsite_minutes']==8 and r['departure_at']==matcher.iso_utc(start+timedelta(minutes=8))
assert r['truck_count']==1 and r['total_truck_minutes']==8
assert run({**gps,'stops':gps['stops']*2})['onsite_minutes']==8,'Duplicate provider stops must not inflate duration'
for field,value in [('street','124 Example Ln'),('city','Covington'),('postalCode','70458'),('stateCode','MS'),('deviceUUID','wrong-tracker'),('stopType','Moving')]:
 g=copy.deepcopy(gps)
 for s in g['stops']:s[field]=value
 assert run(g)['match_confidence']=='ambiguous',(field,value)
for address in ['123 Example Lane Apt 2 Slidell LA 70461','123 Example Lane and 456 Other Road Slidell LA 70461','123 Example Lane Slidell LA 70458','123 Example Lane Slidell LA 70461 note','Building 2 123 Example Lane Slidell LA 70461']:
 assert run(jobs=[{**job,'address':address}])['match_confidence']=='ambiguous',address
assert address_identity(job['address'])==('123 EXAMPLE LN','SLIDELL','70461')
assert run(jobs=[job,{**job,'_appointment_id':'second-job'}])['match_confidence']=='ambiguous','Competing jobs reject attribution'
assert run(jobs=[{**job,'_trucks':['Truck 9']}])['match_confidence']=='ambiguous'
assert run(jobs=[{**job,'job_status':'Cancelled'}])['match_confidence']=='ambiguous'
assert run({**gps,'points':[point(1)]})['match_confidence']=='ambiguous','Pass-by cannot become visit'
assert run({**gps,'stops':[stop(0,2)]})['match_confidence']=='ambiguous','Short stop cannot verify premises'
assert run({**gps,'stops':[stop(300,310)]})['match_confidence']=='ambiguous','Future stop rejected'
assert run({**gps,'points':[point(n) for n in range(9)]})['departure_at'] is None,'No inferred completion from job status'
returned={'points':gps['points']+[point(59,True)]+[point(n) for n in range(60,69)]+[point(n,True) for n in range(69,76)],'stops':gps['stops']+[stop(60,68)]}
r=run(returned);assert r['visit_count']==2 and r['onsite_minutes']==16,'Time away excluded'
p=copy.deepcopy(base);p['visits'][0].update(match_confidence='confirmed',match_reason='qualifying_geofence_dwell');assert run(p=p)==p['visits'][0],'Existing geofence result preserved'
print('Native-stop recovery passed: exact address, assigned tracker, dwell, departure, repeated visits, duplicates, completion recovery and ambiguity rejection.')
