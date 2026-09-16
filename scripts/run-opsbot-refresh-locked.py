#!/usr/bin/env python3
"""Crash-safe refresh serialization, compatible with existing mkdir lock users."""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys


def run_locked(directory, command, env, timeout=600):
    directory = Path(os.path.abspath(directory))
    directory.parent.mkdir(parents=True, exist_ok=True)
    # Never unlink the flock inode. Its descriptor is inherited by the worker,
    # so killing only the launcher cannot admit a concurrent writer.
    lock_path = directory.with_name(directory.name + '.worker')
    guard = directory.with_name(directory.name + '.guard')
    with lock_path.open('a') as lock:
        lock_path.chmod(0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Another OpsCenter refresh is running.', flush=True)
            return 75
        # An atomic symlink serves as the legacy mkdir exclusion marker. A
        # recognizable marker plus ownership of flock proves a crashed worker
        # has released its lock. An ordinary directory belongs to another tool
        # and is never reclaimed automatically.
        if directory.is_symlink() and os.readlink(directory) == str(guard):
            directory.unlink()
        guard.mkdir(mode=0o700, exist_ok=True)
        try:
            directory.symlink_to(guard, target_is_directory=True)
        except FileExistsError:
            print('Another OpsCenter operation owns the legacy refresh lock.', flush=True)
            return 75
        child = None

        def stop(signum=signal.SIGTERM, _frame=None):
            if child is not None:
                try:
                    os.killpg(child.pid, signum)
                except ProcessLookupError:
                    pass

        old_term = signal.signal(signal.SIGTERM, stop)
        old_int = signal.signal(signal.SIGINT, stop)
        try:
            child = subprocess.Popen(command, env=dict(env, OPSCENTER_REFRESH_LOCK_FD=str(lock.fileno())),
                                     pass_fds=(lock.fileno(),), start_new_session=True)
            try:
                return child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                print('OpsCenter refresh exceeded its deadline; previous data retained.', flush=True)
                stop()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    stop(signal.SIGKILL)
                    child.wait()
                return 124
        finally:
            stop(signal.SIGKILL)
            signal.signal(signal.SIGTERM, old_term)
            signal.signal(signal.SIGINT, old_int)
            if directory.is_symlink() and os.readlink(directory) == str(guard):
                directory.unlink()


if __name__ == '__main__':
    root = Path(sys.argv[1])
    sys.exit(run_locked(root / 'tmp/opscenter_refresh.lock',
                        ['/bin/bash', str(root / 'scripts/run_opscenter_refresh.sh'), *sys.argv[2:]], os.environ))
