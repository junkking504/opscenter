#!/usr/bin/env python3
"""Check real worker exclusivity and that GPS locks are not inherited."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

with tempfile.TemporaryDirectory() as temporary:
    root=Path(temporary)
    executable=root/'node'
    executable.write_text('''#!/usr/bin/env python3
import fcntl,os,time
from pathlib import Path
root=Path(os.environ['OPSCENTER_DATA_DIR'])
with open(root/'starts','a') as out: out.write('start\\n')
time.sleep(.3)
with open(root/'gps.lock','a') as gps:
    fcntl.flock(gps,fcntl.LOCK_EX|fcntl.LOCK_NB)
    (root/'gps-free').write_text('yes')
time.sleep(1)
''')
    executable.chmod(0o700)
    env=dict(os.environ,OPSCENTER_DATA_DIR=str(root),PATH=str(root)+os.pathsep+os.environ['PATH'])
    launcher=[sys.executable,str(Path(__file__).with_name('launch-gps-visit-assignments.py')),'2026-09-28']
    def wait_for(check):
        end=time.monotonic()+5
        while not check():
            assert time.monotonic()<end,'Worker did not finish in time'
            time.sleep(.02)
    with open(root/'gps.lock','a') as gps:
        fcntl.flock(gps,fcntl.LOCK_EX|fcntl.LOCK_NB)
        subprocess.run(launcher,env=env,pass_fds=(gps.fileno(),),check=True,timeout=2)
    wait_for(lambda:(root/'starts').exists())
    subprocess.run(launcher,env=env,check=True,timeout=2)
    assert (root/'starts').read_text()=='start\n','Concurrent launch must not duplicate the worker'
    wait_for(lambda:(root/'gps-free').exists())
    with open(root/'gps-visit-assignments/worker.lock','a') as lock:
        def released():
            try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);return True
            except BlockingIOError:return False
        wait_for(released)
    subprocess.run(launcher,env=env,check=True,timeout=2)
    wait_for(lambda:(root/'starts').read_text().count('start')==2)
    with open(root/'gps-visit-assignments/worker.lock','a') as lock:
        wait_for(released)
print('GPS assignment worker passed: background launch, concurrent ownership, automatic release and no inherited GPS lock. Synthetic executable only.')
