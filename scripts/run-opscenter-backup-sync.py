#!/usr/bin/env python3
"""Run one bounded, single-flight backup without blocking source collection."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
from datetime import datetime, timezone


def main():
    source = Path(__file__).resolve().parent.parent
    data = Path(os.environ.get('OPSBOT_DATA_DIR', str(source / 'data')))
    state_dir = data / 'backup-sync'
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if '--background' in sys.argv:
        with (state_dir / 'sync.log').open('ab') as log:
            subprocess.Popen([sys.executable, str(Path(__file__).resolve())],
                             stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                             start_new_session=True, close_fds=True)
        print('Backup scheduled independently of live collection.', flush=True)
        return 0

    with (state_dir / 'sync.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0  # Another release/cycle already owns the transfer.
        state_file = state_dir / 'status.json'
        try:
            previous = json.loads(state_file.read_text())
        except (FileNotFoundError, ValueError):
            previous = {}
        now = lambda: datetime.now(timezone.utc).isoformat()
        state = {'status': 'running', 'startedAt': now(), 'pid': os.getpid(),
                 'lastSuccessAt': previous.get('lastSuccessAt')}

        def save():
            temporary = state_file.with_suffix('.tmp')
            temporary.write_text(json.dumps(state))
            temporary.replace(state_file)

        save()
        def interrupted(signum, frame):
            raise InterruptedError('Backup worker interrupted')
        signal.signal(signal.SIGTERM, interrupted)
        child = None
        try:
            timeout = max(1, int(os.environ.get('OPSCENTER_BACKUP_TIMEOUT_SECONDS', '900')))
            child = subprocess.Popen(['/bin/bash', str(source / 'deploy/vps/sync-data.sh'), 'initial'],
                                     stdin=subprocess.DEVNULL, start_new_session=True, pass_fds=(lock.fileno(),))
            try:
                code = child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                code = 124
            state.update(status='success' if code == 0 else 'failed', exitCode=code, finishedAt=now())
            if code == 0:
                state['lastSuccessAt'] = state['finishedAt']
            save()
            print(f"Backup {state['status']} at {state['finishedAt']} (exit {code}).", flush=True)
            return code
        except Exception as error:
            if child and child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            state.update(status='failed', finishedAt=now(), error=type(error).__name__)
            save()
            raise


if __name__ == '__main__':
    sys.exit(main())
