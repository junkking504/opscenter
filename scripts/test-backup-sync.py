"""Exercise real background/locking/deadline behavior with a synthetic transfer."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

with tempfile.TemporaryDirectory(prefix='ops-backup-check-') as folder:
    root = Path(folder)
    (root / 'scripts').mkdir()
    (root / 'deploy/vps').mkdir(parents=True)
    worker = root / 'scripts/run-opscenter-backup-sync.py'
    shutil.copyfile(Path(__file__).with_name('run-opscenter-backup-sync.py'), worker)
    sync = root / 'deploy/vps/sync-data.sh'
    sync.write_text('echo started >> "$OPSBOT_DATA_DIR/calls"\nsleep 2\nexit 0\n')
    data = root / 'data'
    env = dict(os.environ, OPSBOT_DATA_DIR=str(data))
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
    sync.write_text('exit 0\n')
    subprocess.run([sys.executable, str(worker)], env=env, check=True, capture_output=True)
    assert json.loads(state.read_text())['status'] == 'success', 'Lock releases after timeout'
print('Backup checks passed: nonblocking launch, single flight, deadline, preserved success, and retry.')
