"""Exercise real background/locking/deadline behavior with a synthetic transfer."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import fcntl
import importlib.util
from datetime import datetime, timezone, timedelta

spec = importlib.util.spec_from_file_location('backup_worker', Path(__file__).with_name('run-opscenter-backup-sync.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
at = datetime(2026, 10, 9, tzinfo=timezone.utc)
for seconds, expected in ((0, True), (300, True), (301, False), (-1, False)):
    assert module.recent_success({'lastSuccessAt': (at - timedelta(seconds=seconds)).isoformat()}, at) is expected
for stamp in (None, '', 'invalid', '2026-10-09T00:00:00', 123):
    assert not module.recent_success({'lastSuccessAt': stamp}, at)
assert not module.recent_success({}, at)

with tempfile.TemporaryDirectory(prefix='ops-backup-check-') as folder:
    root = Path(folder)
    (root / 'scripts').mkdir()
    (root / 'deploy/vps').mkdir(parents=True)
    worker = root / 'scripts/run-opscenter-backup-sync.py'
    shutil.copyfile(Path(__file__).with_name('run-opscenter-backup-sync.py'), worker)
    sync = root / 'deploy/vps/sync-data.sh'
    sync.write_text('echo started >> "$OPSBOT_DATA_DIR/calls"\nsleep 2\nexit 0\n')
    data = root / 'data'
    env = dict(os.environ, OPSBOT_DATA_DIR=str(data), OPSCENTER_BACKUP_CALLER='collector')
    start = time.monotonic()
    subprocess.run([sys.executable, str(worker), '--background'], env=env, check=True, capture_output=True)
    assert time.monotonic() - start < 1.5, 'Live collection must not wait for the transfer'
    state = data / 'backup-sync/status.json'
    deadline = time.monotonic() + 8
    while not state.exists() and time.monotonic() < deadline:
        time.sleep(.02)
    subprocess.run([sys.executable, str(worker), '--background'], env=env, check=True, capture_output=True)
    while time.monotonic() < deadline:
        if json.loads(state.read_text())['status'] == 'success':
            break
        time.sleep(.05)
    first = json.loads(state.read_text())
    assert first['status'] == 'success'
    assert (data / 'calls').read_text().splitlines() == ['started'], 'Only one simultaneous transfer'
    sync.write_text('sleep 10\necho unsafe-late-write > "$OPSBOT_DATA_DIR/late"\n')
    result = subprocess.run([sys.executable, str(worker)], env=dict(env, OPSCENTER_BACKUP_TIMEOUT_SECONDS='1'), capture_output=True)
    assert result.returncode == 124
    second = json.loads(state.read_text())
    assert second['status'] == 'failed' and second['lastSuccessAt'] == first['lastSuccessAt']
    assert not (data / 'late').exists(), 'Timed out transfer cannot complete a later write'
    log = data / 'backup-sync/sync.log'
    assert log.read_text().count('(exit 0).') == 1, 'Background completion logged exactly once'
    assert log.read_text().count('(exit 124).') == 1, 'Foreground timeout must be logged'
    sync.write_text('echo transfer-output\necho transfer-error >&2\nexit 23\n')
    failed = subprocess.run([sys.executable, str(worker)], env=env, capture_output=True)
    assert failed.returncode == 23
    assert log.read_text().count('(exit 23).') == 1
    assert 'transfer-output' in log.read_text() and 'transfer-error' in log.read_text()
    assert json.loads(state.read_text())['lastSuccessAt'] == first['lastSuccessAt']
    sync.write_text('exit 24\n')
    vanished = subprocess.run([sys.executable, str(worker)], env=env, capture_output=True)
    assert vanished.returncode == 24
    assert json.loads(state.read_text())['status'] == 'success'
    assert json.loads(state.read_text())['lastSuccessAt'] == first['lastSuccessAt'], 'Vanished files cannot refresh full-success age'
    assert log.read_text().count('(exit 24).') == 1
    sync.write_text('exit 0\n')
    subprocess.run([sys.executable, str(worker)], env=env, check=True, capture_output=True)
    assert json.loads(state.read_text())['status'] == 'success', 'Lock releases after timeout'
    assert log.read_text().count('(exit 0).') == 2, 'Foreground success logged once too'
    # Publisher deadlines are separate from the shared backup verdict. Keep
    # both fresh success and a previous real failure byte-for-byte unchanged.
    publisher = dict(env, OPSCENTER_BACKUP_CALLER='continuity-publisher', OPSCENTER_BACKUP_TIMEOUT_SECONDS='1')
    attempt = data / 'backup-sync/publisher-status.json'
    sync.write_text('echo started >> "$OPSBOT_DATA_DIR/calls"\nexit 0\n')
    calls = (data / 'calls').read_bytes()
    for prior in ('success', 'failed'):
        previous = dict(json.loads(state.read_text()), status=prior, exitCode=0 if prior == 'success' else 255,
                        lastSuccessAt=datetime.now(timezone.utc).isoformat())
        state.write_text(json.dumps(previous))
        before = state.read_bytes()
        result = subprocess.run([sys.executable, str(worker)], env=publisher, capture_output=True)
        assert result.returncode == (0 if prior == 'success' else 255)
        assert state.read_bytes() == before, 'A skip cannot clear failure or advance shared freshness'
        assert (data / 'calls').read_bytes() == calls, 'Recent success must skip the transfer entirely'
        receipt = json.loads(attempt.read_text())
        assert receipt['status'] == 'skipped' and receipt['reason'] == 'recent_success'
        assert receipt['lastSuccessAt'] == previous['lastSuccessAt'] and receipt['recentSuccessWindowSeconds'] == 300
        with (data / 'backup-sync/sync.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    subprocess.run([sys.executable, str(worker)], env=env, check=True, capture_output=True)
    assert (data / 'calls').read_bytes() != calls, 'Collector transfers are never skipped for recent success'
    for prior in ('success', 'failed'):
        previous = dict(json.loads(state.read_text()), status=prior, exitCode=0 if prior == 'success' else 255,
                        lastSuccessAt='2000-01-01T00:00:00+00:00')
        state.write_text(json.dumps(previous))
        before = state.read_bytes()
        sync.write_text('sleep 10\necho unsafe-publisher-write > "$OPSBOT_DATA_DIR/publisher-late"\n')
        result = subprocess.run([sys.executable, str(worker)], env=publisher, capture_output=True)
        assert result.returncode == (0 if prior == 'success' else 255) and state.read_bytes() == before
        receipt = json.loads(attempt.read_text())
        assert receipt['status'] == 'deferred' and receipt['reason'] == 'caller_deadline'
        assert receipt['caller'] == 'continuity-publisher' and receipt['timeoutSeconds'] == 1
        assert not (data / 'publisher-late').exists()
    # An unset caller with a reduced timeout is still an ordinary collector.
    legacy = dict(publisher)
    del legacy['OPSCENTER_BACKUP_CALLER']
    before_attempt = attempt.read_bytes()
    result = subprocess.run([sys.executable, str(worker)], env=legacy, capture_output=True)
    assert result.returncode == 124
    assert json.loads(state.read_text())['status'] == 'failed'
    assert json.loads(state.read_text())['caller'] == 'collector'
    assert attempt.read_bytes() == before_attempt, 'Collector timeout cannot become a publisher deferral'
    for code in (23, 255, 12, 10, 124):
        sync.write_text(f'exit {code}\n')
        result = subprocess.run([sys.executable, str(worker)], env=publisher, capture_output=True)
        assert result.returncode == code
        assert json.loads(state.read_text())['status'] == 'failed', 'Actual transfer exit, including 124, must not be hidden'
        assert json.loads(state.read_text())['exitCode'] == code
    sync.write_text('exit 0\n')
    subprocess.run([sys.executable, str(worker)], env=publisher, check=True, capture_output=True)
    assert json.loads(state.read_text())['status'] == 'success', 'Verified publisher success updates shared backup freshness'
    state.unlink()
    sync.write_text('sleep 10\n')
    subprocess.run([sys.executable, str(worker)], env=publisher, capture_output=True)
    assert not state.exists(), 'Publisher deadline cannot invent a first backup result'
    bad = subprocess.run([sys.executable, str(worker)], env=dict(env, OPSCENTER_BACKUP_TIMEOUT_SECONDS='invalid'), capture_output=True)
    assert bad.returncode != 0 and json.loads(state.read_text())['status'] == 'failed'
    assert log.read_text().count('(error ValueError).') == 1, 'Worker errors must be logged'
print('Backup checks passed: nonblocking launch, single flight, deadline, preserved success, and retry.')

# Run the actual sync script/filter order with real rsync, replacing only the
# network transport with two local fixture directories. No SSH or live data.
with tempfile.TemporaryDirectory(prefix='ops-backup-filters-') as folder:
    root = Path(folder)
    local, remote, bin_dir = root / 'local', root / 'remote', root / 'bin'
    for directory in (local, remote, bin_dir):
        directory.mkdir()
    real_rsync = shutil.which('rsync')
    assert real_rsync, 'rsync is required to validate actual filter semantics'
    (bin_dir / 'ssh').write_text('#!/bin/sh\nexit 0\n')
    wrapper = '''#!/usr/bin/env python3
import os, subprocess, sys
args = sys.argv[1:]
if '-e' in args:
    transport = args.index('-e')
    del args[transport:transport + 2]
args = [arg.removeprefix('fixture:') for arg in args]
raise SystemExit(subprocess.call([os.environ['TEST_REAL_RSYNC'], *args]))
'''
    (bin_dir / 'rsync').write_text(wrapper)
    for p in bin_dir.iterdir():
        p.chmod(0o755)
    kept = [
        'metrics.json', 'job-route-assignments/assignments.json',
        'integrations/whatsapp-job-photos/context-bindings/binding.json',
        'integrations/whatsapp-job-photos/processing/photo.json',
        'integrations/whatsapp-job-photos/completed/photo.json',
        'integrations/whatsapp-job-photos/review/photo.json',
        'integrations/whatsapp-job-photos/media/photo.jpg',
        'manual_bonuses/bonus.json', 'finance/statement.json',
    ]
    excluded = [
        'root.json.lock', 'root.tmp', 'root.tmp-123',
        'job-route-assignments/.junkware-assignment-sync.lock/owner.json',
        'job-route-assignments/visible.lock/owner.json',
        'integrations/whatsapp-job-photos/context-bindings/binding.json.lock',
        'integrations/whatsapp-job-photos/processing/photo.tmp',
        'integrations/whatsapp-job-photos/context-bindings/binding.tmp-123',
    ]
    env = dict(os.environ, PATH=f'{bin_dir}:{os.environ["PATH"]}',
               OPSCENTER_VPS='fixture', OPSCENTER_REMOTE_ROOT=str(remote),
               OPSBOT_DATA_DIR=str(local), OPSCENTER_SSH_KEY='', TEST_REAL_RSYNC=real_rsync)
    script = Path(__file__).resolve().parent.parent / 'deploy/vps/sync-data.sh'
    for mode in ('initial', 'incremental'):
        for directory in (local, remote):
            shutil.rmtree(directory)
            directory.mkdir()
        (remote / 'data').mkdir()
        source, target = (local, remote / 'data') if mode == 'initial' else (remote / 'data', local)
        for name in kept + excluded:
            file = source / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('fixture')
        result = subprocess.run(['/bin/bash', str(script), mode], env=env, capture_output=True, text=True)
        assert result.returncode == 0, f'{mode}: {result.stdout} {result.stderr}'
        expected = kept if mode == 'initial' else [name for name in kept if name != 'metrics.json']
        assert all((target / name).is_file() for name in expected), f'{mode}: durable records must survive'
        assert not any((target / name).exists() for name in excluded), f'{mode}: transient state must be excluded'
print('Real rsync checks passed: initial push and incremental pull preserve records and exclude locks/temp files.')
