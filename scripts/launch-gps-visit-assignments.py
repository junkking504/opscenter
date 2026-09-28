#!/usr/bin/python3
"""Start one assignment worker without blocking GPS collection or inheriting its lock."""
import fcntl
import os
from pathlib import Path
import re
import subprocess
import sys

def main():
    date = sys.argv[1] if len(sys.argv)>1 else ''
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',date):
        return 64
    checkout=Path(__file__).resolve().parent.parent
    root=Path(os.environ.get('OPSCENTER_DATA_DIR') or os.environ.get('OPSBOT_DATA_DIR') or checkout/'data')
    directory=root/'gps-visit-assignments'
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    with open(directory/'worker.lock','a') as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        env=dict(os.environ,OPSCENTER_GPS_ASSIGNMENT_LOCK_HELD='1',OPSCENTER_DATA_DIR=str(root),OPSBOT_DATA_DIR=str(root))
        env.setdefault('JOB_ROUTE_ASSIGNMENTS_FILE',str(root/'job-route-assignments/assignments.json'))
        env.setdefault('OPSCENTER_DESKTOP_OPERATIONS_DIR',str(root/'desktop-operations'))
        with open(directory/'latest.log','w') as log:
            subprocess.Popen(['node','--import','tsx','scripts/reconcile-gps-visit-assignments.ts',date],cwd=checkout,env=env,
                             stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True,close_fds=True,pass_fds=(lock.fileno(),))
    return 0

if __name__=='__main__':
    raise SystemExit(main())
