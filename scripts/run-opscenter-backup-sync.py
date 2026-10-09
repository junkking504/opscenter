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
        # Preserve startup errors too, before the worker can open its own log.
        with (state_dir / 'sync.log').open('ab') as log:
            subprocess.Popen([sys.executable, str(Path(__file__).resolve())],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=log,
                             start_new_session=True, close_fds=True)
        print('Backup scheduled independently of live collection.', flush=True)
        return 0

    # The worker owns logging in both invocation modes; the launcher must not
    # also redirect stdout here or completion records would be duplicated.
    with (state_dir / 'sync.log').open('a', buffering=1) as log, \
            (state_dir / 'sync.lock').open('a') as lock:
        def report(message):
            print(message, file=log, flush=True)
            print(message, flush=True)

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

        attempt_file = state_file

        def save(publish=True):
            temporary = attempt_file.with_suffix('.tmp')
            temporary.write_text(json.dumps(state))
            temporary.replace(attempt_file)
            if publish and attempt_file != state_file:
                temporary = state_file.with_suffix('.tmp')
                temporary.write_text(json.dumps(state))
                temporary.replace(state_file)
        def interrupted(signum, frame):
            raise InterruptedError('Backup worker interrupted')
        signal.signal(signal.SIGTERM, interrupted)
        child = None
        try:
            timeout = max(1, int(os.environ.get('OPSCENTER_BACKUP_TIMEOUT_SECONDS', '900')))
            # The installed continuity publisher predates the explicit caller.
            # Its short deadline is enough to select the budgeted-attempt record
            # without modifying installed controls during an application release.
            caller = os.environ.get('OPSCENTER_BACKUP_CALLER') or ('short-budget' if timeout < 900 else 'collector')
            if caller not in ('collector', 'short-budget', 'continuity-publisher'):
                raise ValueError('Unknown backup caller')
            budgeted = caller != 'collector'
            if budgeted:
                attempt_file = state_dir / 'publisher-status.json'
            state.update(caller=caller, timeoutSeconds=timeout)
            save(publish=not budgeted)
            deadline_expired = False
            child = subprocess.Popen(['/bin/bash', str(source / 'deploy/vps/sync-data.sh'), 'initial'],
                                     stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                     start_new_session=True, pass_fds=(lock.fileno(),))
            try:
                code = child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                deadline_expired = True
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                code = 124
            # rsync exit 24 means files vanished between the file list and the
            # transfer. Under a live queue that is normal, not a backup failure;
            # 17 of 485 runs previously reported "failed" for exactly this, and
            # nothing distinguished them from a real failure.
            if budgeted and deadline_expired:
                state.update(status='deferred', exitCode=124, finishedAt=now(), reason='caller_deadline')
                save(publish=False)
                report(f"Backup deferred at {state['finishedAt']} (exit 124; caller {caller}, budget {timeout}s).")
                # A deferral is a completed scheduling decision, not a failed
                # transfer. The legacy publisher propagates any nonzero return
                # into its monitor; freshness still comes only from status.json.
                return 0
            succeeded = code in (0, 24)
            state.update(status='success' if succeeded else 'failed', exitCode=code, finishedAt=now())
            if code == 0:
                state['lastSuccessAt'] = state['finishedAt']
            save()
            report(f"Backup {state['status']} at {state['finishedAt']} (exit {code}).")
            if not succeeded:
                report(f"Backup failed; exit {code} needs review. See backup health signal.")
            return code
        except Exception as error:
            if child and child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            state.update(status='failed', finishedAt=now(), error=type(error).__name__)
            save()
            report(f"Backup failed at {state['finishedAt']} (error {type(error).__name__}).")
            raise


if __name__ == '__main__':
    sys.exit(main())
