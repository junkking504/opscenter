import importlib.util
import json
import tempfile
from pathlib import Path
from datetime import datetime

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
print('JunkWare charge stream passed: bounded reads, cache reuse, changed charges, identity date rejection, and schedule preservation.')
