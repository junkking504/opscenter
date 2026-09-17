import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
spec=importlib.util.spec_from_file_location('replay',Path(__file__).with_name('replay-address-visits.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as temp:
 root=Path(temp);queue=root/'data/addresses/agent/rematch';queue.mkdir(parents=True)
 gps=root/'data/history/linxup';gps.mkdir(parents=True);(gps/'linxup_location_2026-09-17.json').write_text('{}')
 request={'date':'2026-09-17','geocodeKey':'example','latitude':30.2,'longitude':-89.8}
 first=queue/'request1.json';first.write_text(json.dumps(request));calls=[]
 m.replay(root,root,lambda *a,**kw:calls.append(a));assert not calls and first.exists(),'Intent waits for committed coordinates'
 cache=root/'data/cache/appointment_geocodes.json';cache.parent.mkdir();cache.write_text(json.dumps({'addresses':{'example':{'latitude':30.2,'longitude':-89.8,'house_street_verified':True}}}))
 def fail(command,**kwargs):calls.append(command);raise subprocess.CalledProcessError(1,command)
 try:m.replay(root,root,fail)
 except subprocess.CalledProcessError:pass
 assert first.exists(),'Failed matcher must retain recovery request'
 def succeed(command,**kwargs):
  calls.append(command)
  if 'validate' in command[1]:(queue/'request2.json').write_text(json.dumps(request))
 m.replay(root,root,succeed)
 assert not first.exists() and (queue/'request2.json').exists(),'Concurrent new correction survives acknowledgement'
 assert all('publish' not in command[1] for command in calls),'Replays never send messages'
 print('Address visit replay passed: retry, validation before acknowledgement, concurrent corrections, no message publication.')
