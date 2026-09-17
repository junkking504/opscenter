import os
from pathlib import Path
import subprocess
import tempfile
import time
import sys
runner=Path(__file__).with_name('run-address-verification-agent.py')
with tempfile.TemporaryDirectory() as temporary:
 root=Path(temporary);bin=root/'bin';bin.mkdir();log=root/'calls'
 node=bin/'node';node.write_text('#!/bin/sh\necho called >> "$TASK_AGENT_LOG"\nsleep 1\n');node.chmod(0o755)
 env=dict(os.environ,PATH=str(bin)+':'+os.environ['PATH'],OPSCENTER_DATA_DIR=str(root/'data'),TASK_AGENT_LOG=str(log))
 first=subprocess.Popen([sys.executable,str(runner),'2026-09-17'],env=env)
 deadline=time.time()+5
 while not log.exists() and time.time()<deadline:time.sleep(.01)
 assert log.exists()
 second=subprocess.run([sys.executable,str(runner),'2026-09-17'],env=env,timeout=1)
 assert second.returncode==0 and log.read_text().count('called')==1,'Busy owner must not start duplicate work'
 assert first.wait(timeout=3)==0
 assert subprocess.run([sys.executable,str(runner),'2026-09-17'],env=env,timeout=3).returncode==0
 assert log.read_text().count('called')==2,'Permanent lock inode must permit the next run'
 assert subprocess.run([sys.executable,str(runner),'bad-date'],env=env).returncode==64
 print('Address worker lock passed: independent lock, duplicate suppression, restart and invalid date handling.')
