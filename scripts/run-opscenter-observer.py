#!/usr/bin/python3
"""Finite observation run with an OS lock automatically released on exit/crash."""
import fcntl
import os
import pathlib
import subprocess
import sys
sys.dont_write_bytecode = True
from opscenter_process_recovery import tick, atomic_json
import time

home = pathlib.Path.home()
app = pathlib.Path(__file__).resolve().parent.parent
state = pathlib.Path(os.environ.get('OPSBOT_DATA_DIR', str(home / '.openclaw/workspace/opsbot/data'))) / 'integrations/opscenter-maintenance'
state.mkdir(parents=True, exist_ok=True, mode=0o700)
with open(state / 'worker.lock', 'a') as lock:
    os.chmod(state / 'worker.lock', 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit(0)
    env = dict(os.environ, OPSCENTER_MAINTENANCE_LOCK_HELD='1')
    try:
        tick(state)
        (state / 'recovery-error.json').unlink(missing_ok=True)
    except Exception:
        # Preserve every ledger and reservation; report only a fixed safe message.
        atomic_json(state / 'recovery-error.json', {'at': int(time.time()), 'status': 'Recovery evidence or ledger unavailable; automatic action blocked'})
        print('Process recovery blocked: evidence or ledger needs review.', flush=True)
    try:
        # Inherit the lock so killing the launcher does not unlock a live child.
        result = subprocess.run(['/opt/homebrew/bin/node', '--import', 'tsx', 'scripts/observe-opscenter.ts'], cwd=app, env=env, timeout=90, pass_fds=(lock.fileno(),))
        raise SystemExit(result.returncode)
    except subprocess.TimeoutExpired:
        print('Maintenance observation exceeded its time limit; see the separate recovery receipt for any process action.', flush=True)
        raise SystemExit(1)
