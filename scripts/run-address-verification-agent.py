#!/usr/bin/python3
"""Dedicated address-verification worker with an independent crash-safe lock."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
import re

def main():
    checkout = Path(__file__).resolve().parent.parent
    root = Path(os.environ.get('OPSCENTER_DATA_DIR') or os.environ.get('OPSBOT_DATA_DIR') or Path.home() / '.openclaw/workspace/opsbot/data')
    target = sys.argv[1] if len(sys.argv) > 1 else datetime.now(ZoneInfo('America/Chicago')).date().isoformat()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', target):
        return 64
    directory = root / 'addresses/agent'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / 'worker.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        env = dict(os.environ, OPSCENTER_DATA_DIR=str(root), OPSBOT_DATA_DIR=str(root), OPSCENTER_ADDRESS_AGENT_LOCK_HELD='1')
        try:
            return subprocess.run(['node','--import','tsx','scripts/refresh-schedule-map-inputs.ts',target],cwd=checkout,env=env,pass_fds=(lock.fileno(),),timeout=90).returncode
        except subprocess.TimeoutExpired:
            print('Address agent deadline reached; saved evidence and request reservations retained.',file=sys.stderr)
            return 124

if __name__ == '__main__':
    sys.exit(main())
