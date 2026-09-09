import importlib.util
import json
import os
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('stream', Path(__file__).with_name('collect-junkware-schedule-stream.py'))
stream = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stream)
date = '2026-09-08'


class Page:
    def __init__(self, context): self.context = context; self.url = ''; self.closed = False
    def goto(self, url, **kwargs): self.url = url
    def close(self): self.closed = True


class Context:
    def new_page(self): return Page(self)


class Collector:
    _JS_APPT_DETAILS = 'details'
    def __init__(self): self.page = Page(Context()); self.reads = 0; self.wrong_date = False
    def evaluate(self, script):
        if script != 'details': return 'Truck# 3'
        self.reads += 1
        return dict(url=self.page.url, appointmentDate='9/9/2026' if self.wrong_date else '9/8/2026', finalStatus='Completed', finalAppointmentType='Job', closeout=dict(loadSize='3/4', bedloadSize='1/4', total='$150'))


def row(identity): return dict(appt_id=identity,truck='Truck# 3',appointment_type='Job',job_status='Completed',revenue='$150',tip='')


with tempfile.TemporaryDirectory() as root:
    root = Path(root); collector = Collector(); original = collector.page
    rows = stream.enrich_closed_charges(collector, root, date, '352', [row('1001'),row('1002')])
    assert collector.reads == 1 and collector.page is original
    assert rows[0]['closeout']['bedloadSize'] == '1/4'
    assert rows[1]['closeout_refresh_pending'] is True
    stream.write_snapshot(root,date,'352','Junk King New Orleans',rows,[],'test')
    rows = stream.enrich_closed_charges(collector, root, date, '352', [row('1001'),row('1002')])
    assert collector.reads == 2 and all('closeout' in item for item in rows)
    stream.write_snapshot(root,date,'352','Junk King New Orleans',rows,[],'test')
    stream.enrich_closed_charges(collector, root, date, '352', [row('1001'),row('1002')])
    assert collector.reads == 2, 'Unchanged verified charges should be reused'
    changed = row('1001'); changed['revenue'] = '$200'
    stream.enrich_closed_charges(collector, root, date, '352', [changed])
    assert collector.reads == 3, 'Changed charge signature must be read again'
    collector.wrong_date = True
    rejected = stream.enrich_closed_charges(collector,root,date,'352',[row('1003')])
    assert 'closeout' not in rejected[0] and rejected[0]['closeout_refresh_pending']
    assert collector.page is original, 'Failure must restore the schedule tab'

with tempfile.TemporaryDirectory() as root:
    root = Path(root); collector = Collector()
    verified = stream.enrich_closed_charges(collector, root, date, '352', [row('1001')])
    for market_id, market_name in stream.MARKETS:
        stream.write_snapshot(root,date,market_id,market_name,verified if market_id == '352' else [],[],'test')

    def projected_load():
        # Exercise the actual source reader and load projection with a fast-only job.
        source = "const {readOperationalTruckLoads}=require('./lib/truck-load-closeouts.ts');console.log(JSON.stringify(readOperationalTruckLoads('2026-09-08').find(x=>x.truck==='Truck# 3')));"
        result = subprocess.check_output(['node','--import','tsx','-e',source],cwd=Path(__file__).resolve().parents[1],env={**os.environ,'OPSBOT_DATA_DIR':str(root),'OPSCENTER_DATA_DIR':str(root)},text=True)
        return json.loads(result)

    before = projected_load()
    assert before['chargedTruckFraction'] == .75
    assert before['currentLoadFraction'] == .75
    bare = {**row('1001'),'market':'Junk King New Orleans'}
    collector.collect_all_markets = lambda _: ('test',[bare],[],{'verified_date':date,'all_territories_verified':True})
    with patch.object(stream,'publish_snapshot'):
        stream.initialize(collector,Path('.'),root,date)
    after = projected_load()
    assert after['currentLoadFraction'] == before['currentLoadFraction'], 'A collector restart must not drop a previously confirmed load'
    assert after['chargedTruckFraction'] == before['chargedTruckFraction']
    assert after['currentBedloadFraction'] == before['currentBedloadFraction']
    assert collector.reads == 1, 'Restart recovery must reuse verified local details without extra provider reads'
    for change in ({'truck':'Truck# 9'},{'revenue':'$200'},{'appointment_type':'Estimate'},{'job_status':'Confirmed'}):
        invalidated = stream.enrich_closed_charges(collector,root,date,'352',[{**row('1001'),**change}],read_limit=0)[0]
        assert 'closeout' not in invalidated, 'A changed assignment, charge, type or status must not inherit old details'
    expired = json.loads(stream.snapshot_file(root,'352',date).read_text())['appointments'][0]
    expired['closeout_verified_at'] = (datetime.now(stream.TIMEZONE)-timedelta(minutes=10)).isoformat()
    stream.write_snapshot(root,date,'352','Junk King New Orleans',[expired],[],'test')
    retained = stream.enrich_closed_charges(collector,root,date,'352',[row('1001')],read_limit=0)[0]
    assert retained['closeout'] == expired['closeout']
    assert retained['closeout_verified_at'] == expired['closeout_verified_at'], 'Reuse must not pretend a new source verification occurred'
    assert retained['closeout_refresh_pending'] is True, 'Expired details remain provisional until their ordinary refresh'
    assert collector.reads == 1

print('JunkWare charge stream passed: bounded reads, cache reuse, changed charges, identity date rejection, schedule preservation, and confirmed loads surviving collector restart.')
