#!/usr/bin/env python3
"""Read one requested schedule day into a separate verified schedule cache."""
import argparse
import fcntl
import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path

READER_DEADLINE_SECONDS = 175  # Finish before the application's 180-second timeout.


def run_supervised(command, lock_path, timeout=READER_DEADLINE_SECONDS):
    """Own the lock and browser process group outside Playwright's event loop."""
    lock_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Another schedule reader is still running.', file=sys.stderr)
            return 75
        parent = os.getppid()
        worker = None
        previous_handler = signal.getsignal(signal.SIGTERM)

        def terminate(*_):
            raise SystemExit(143)

        signal.signal(signal.SIGTERM, terminate)
        try:
            # The isolated auth copy and browser scratch files belong only to
            # this invocation and can be removed after its process group exits.
            with tempfile.TemporaryDirectory(prefix='opscenter-schedule-reader-') as scratch:
                try:
                    worker = subprocess.Popen(
                        command, start_new_session=True, pass_fds=(lock.fileno(),),
                        env={**os.environ, 'TMPDIR': scratch},
                    )
                    deadline = time.monotonic() + timeout
                    while worker.poll() is None:
                        if os.getppid() != parent or parent == 1:
                            print('Schedule reader owner exited.', file=sys.stderr)
                            return 125
                        if time.monotonic() >= deadline:
                            print('Schedule reader exceeded its hard deadline.', file=sys.stderr)
                            return 124
                        time.sleep(min(0.1, max(0, deadline - time.monotonic())))
                    return worker.returncode
                finally:
                    if worker is not None:
                        # Also remove leftover browser children after a normal
                        # Python exit. This group contains only our worker.
                        try:
                            os.killpg(worker.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        worker.wait(timeout=5)
        finally:
            signal.signal(signal.SIGTERM, previous_handler)


def install_worker_deadline(seconds=READER_DEADLINE_SECONDS):
    # Independent fallback if the supervisor itself is forcibly terminated.
    # Do not re-enter Playwright cleanup from this signal handler.
    def expired(*_):
        os.killpg(os.getpid(), signal.SIGKILL)
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', required=True, type=date.fromisoformat)
    parser.add_argument('--opsbot-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.worker:
        return run_supervised(
            [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--worker'],
            args.opsbot_dir / 'data' / 'schedule-requests' / 'reader.lock',
        )
    # Workers run in the supervisor-created private process group. Refuse an
    # accidental direct invocation rather than targeting a caller's group.
    if os.getpgrp() != os.getpid():
        raise RuntimeError('Schedule worker requires its own process group.')
    install_worker_deadline()
    spec = importlib.util.spec_from_file_location('forward_schedule', Path(__file__).with_name('collect-junkware-forward-schedule.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    collector, _paths = helper.load_collector(args.opsbot_dir)
    isolated = helper.isolate_browser_session(collector)
    def terminate(*_):
        raise SystemExit(1)
    signal.signal(signal.SIGTERM, terminate)
    try:
        result = collector.collect_attendance_source(args.date.isoformat())
        verification = result['verification']
        if not verification.get('all_territories_verified'):
            raise RuntimeError('Not all JunkWare markets were verified')
        helper.write_json_atomic(args.output, {
            'date': args.date.isoformat(), 'scraped_at': result['collection_timestamp'],
            'source': 'Requested JunkWare schedule day',
            'appointments': result['appointment_rows'], 'cancelled': result['cancel_rows'],
            'markets_scraped': verification.get('verified_markets', []),
            'territory_verification': verification.get('territories', []),
        })
        print(json.dumps({'ok': True, 'date': args.date.isoformat()}))
    finally:
        collector.close_browser()
        isolated.unlink(missing_ok=True)


if __name__ == '__main__':
    sys.exit(main())
