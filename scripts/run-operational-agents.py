#!/usr/bin/python3
"""Bounded, crash-safe ownership for the two local operational agents."""
import fcntl
import os
import pathlib
import re
import subprocess
import sys


def main():
    date = sys.argv[1] if len(sys.argv) > 1 else ''
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
        return 64
    checkout = pathlib.Path(__file__).resolve().parent.parent
    root = pathlib.Path(os.environ.get('OPSCENTER_DATA_DIR') or os.environ.get('OPSBOT_DATA_DIR') or checkout / 'data')
    directory = root / 'fleet' / 'agents'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Never unlink the permanent lock inode; the OS releases it on crash/exit.
    with open(directory / 'worker.lock', 'a') as lock:
        os.chmod(directory / 'worker.lock', 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        env = dict(os.environ, OPSCENTER_DATA_DIR=str(root), OPSCENTER_AGENT_LOCK_HELD='1')
        try:
            return subprocess.run(['node', '--import', 'tsx', 'scripts/run-operational-agents.ts', date], cwd=checkout, env=env, pass_fds=(lock.fileno(),), timeout=20, check=False).returncode
        except subprocess.TimeoutExpired:
            print('Operational agents exceeded the local deadline; last successful results retained.', file=sys.stderr)
            return 124


if __name__ == '__main__':
    sys.exit(main())
