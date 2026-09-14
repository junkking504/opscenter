#!/usr/bin/python3
"""Serialize poll and push processing with a crash-safe, inherited OS lock."""
import fcntl
import os
import pathlib
import signal
import subprocess
import sys


def run_locked(directory, command, env, busy_code=0, timeout=300):
    directory = pathlib.Path(directory)
    directory.parent.mkdir(parents=True, exist_ok=True)
    try:
        directory.mkdir(mode=0o700)
    except FileExistsError:
        if not (directory / 'worker.lock').is_file():
            # Never steal an old release's mkdir lock. Migration requires proving
            # its writer has exited and removing only the empty legacy directory.
            print('LinxUp legacy processor lock present; preserving queued updates.', flush=True)
            return busy_code
    # Keep this inode permanently. Unlinking a flock file can create two owners.
    with open(directory / 'worker.lock', 'a') as lock:
        os.chmod(directory / 'worker.lock', 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return busy_code
        child_env = dict(env, OPSCENTER_LINXUP_LOCK_FD=str(lock.fileno()))
        child = subprocess.Popen(command, env=child_env, pass_fds=(lock.fileno(),), start_new_session=True)

        def stop(signum=signal.SIGTERM, _frame=None):
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass

        old_term = signal.signal(signal.SIGTERM, stop)
        old_int = signal.signal(signal.SIGINT, stop)
        try:
            try:
                return child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                print('LinxUp processing exceeded its deadline; durable updates retained.', flush=True)
                stop()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    stop(signal.SIGKILL)
                    child.wait()
                return 124
        finally:
            # Also reap descendants after a shell exits early. Only this run's
            # isolated process group is eligible; shared services are untouched.
            stop(signal.SIGKILL)
            signal.signal(signal.SIGTERM, old_term)
            signal.signal(signal.SIGINT, old_int)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('refresh', 'push'):
        return 64
    mode, args = sys.argv[1], sys.argv[2:]
    script = 'run-linxup-live-refresh.sh' if mode == 'refresh' else 'run-linxup-push.sh'
    bot = pathlib.Path(os.environ.get('OPSBOT_DIR', str(pathlib.Path.home() / '.openclaw/workspace/opsbot')))
    busy = 75 if mode == 'push' and args and args[0] != '--drain' else 0
    return run_locked(bot / 'tmp/linxup_live_refresh.lock',
                      ['/bin/bash', str(pathlib.Path(__file__).resolve().parent / script), *args], os.environ, busy)


if __name__ == '__main__':
    sys.exit(main())
