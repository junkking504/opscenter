#!/usr/bin/env python3
"""Exchange sanitized release/backup evidence with the independent VPS observer."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone

ROOT = Path.home() / 'Library/Application Support/OpsCenter/continuity-control'
SSH = ['ssh', '-i', str(Path.home() / '.ssh/id_ed25519_opscenter'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', 'opscenter@104.248.63.228']


def main():
    os.umask(0o077)
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (ROOT / 'monitor-collector.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        at = datetime.now(timezone.utc).isoformat()
        file = ROOT / 'monitor.json'
        try:
            previous = json.loads(file.read_text())
        except (ValueError, OSError):
            previous = {}
        try:
            publication = json.loads((ROOT / 'database-publish.json').read_text())
        except (ValueError, OSError):
            publication = {}
        evidence = {'version': 1, 'observedAt': at, 'release': (Path.home() / 'opscenter-v2/opscenter').resolve().name,
                    'publication': {key: publication.get(key) for key in ('status', 'lastSuccessAt', 'fileLastSuccessAt', 'financialStatementsSyncedAt', 'fileSyncExitCode')}}
        try:
            result = subprocess.run(SSH + ['/usr/bin/python3 /home/opscenter/continuity-monitor/observe.py --exchange'],
                input=json.dumps(evidence), text=True, capture_output=True, check=True, timeout=30)
            if len(result.stdout) > 262144:
                raise ValueError('Oversized monitor response')
            remote = json.loads(result.stdout)
            if remote.get('version') != 1 or not isinstance(remote.get('checks'), list):
                raise ValueError('Invalid monitor response')
            status = {'bridgeStatus': 'success', 'receivedAt': at, 'remote': remote}
        except Exception:
            status = {'bridgeStatus': 'failed', 'receivedAt': at, 'remote': previous.get('remote')}
        temp = file.with_suffix('.pending')
        with temp.open('w') as output:
            json.dump(status, output); output.flush(); os.fsync(output.fileno())
        temp.replace(file)
        print('Continuity monitor exchange: ' + status['bridgeStatus'])


if __name__ == '__main__':
    main()
