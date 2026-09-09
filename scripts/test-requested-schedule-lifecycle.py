#!/usr/bin/env python3
"""Synthetic subprocess tests: no browser, credentials, or external collection."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import time

SCRIPT = Path(__file__).with_name('collect-junkware-requested-day.py').resolve()
spec = importlib.util.spec_from_file_location('reader', SCRIPT)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
IMPORT = f"import importlib.util; s=importlib.util.spec_from_file_location('reader',{str(SCRIPT)!r}); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "


def await_file(file, process):
    deadline = time.monotonic() + 5
    while not file.exists():
        assert process.poll() is None, f'Process exited before creating {file}'
        assert time.monotonic() < deadline, f'Timed out waiting for {file}'
        time.sleep(0.02)
    return json.loads(file.read_text())


def stopped(pid):
    try:
        row = subprocess.check_output(['ps', '-p', str(pid), '-o', 'stat='], text=True).strip()
        return not row or row.startswith('Z')
    except subprocess.CalledProcessError:
        return True


def await_stopped(pid):
    deadline = time.monotonic() + 5
    while not stopped(pid):
        assert time.monotonic() < deadline, f'Synthetic child {pid} survived'
        time.sleep(0.02)


with tempfile.TemporaryDirectory(prefix='reader-lifecycle-test-') as directory:
    root = Path(directory)
    lock = root / 'reader.lock'
    assert reader.run_supervised([sys.executable, '-c', 'pass'], lock, timeout=2) == 0
    assert reader.run_supervised([sys.executable, '-c', 'raise SystemExit(7)'], lock, timeout=2) == 7

    # Simulate hung cleanup that ignores TERM, including a browser child.
    marker = root / 'timeout.json'
    worker = "import os,signal,subprocess,sys,json,time; from pathlib import Path; " + \
        "signal.signal(signal.SIGTERM,signal.SIG_IGN); child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); " + \
        f"Path({str(marker)!r}).write_text(json.dumps({{'pid':os.getpid(),'child':child.pid,'scratch':os.environ['TMPDIR']}})); " + \
        "time.sleep(60)"
    start = time.monotonic()
    assert reader.run_supervised([sys.executable, '-c', worker], lock, timeout=0.4) == 124
    assert time.monotonic() - start < 3
    state = json.loads(marker.read_text())
    await_stopped(state['pid']); await_stopped(state['child'])
    assert not Path(state['scratch']).exists(), 'Private scratch must be removed'

    # A process-held lock blocks a second invocation regardless of JSON age.
    marker.unlink()
    supervisor_code = IMPORT + f"sys_exit=m.run_supervised({[sys.executable, '-c', worker]!r},m.Path({str(lock)!r}),timeout=10); raise SystemExit(sys_exit)"
    supervisor = subprocess.Popen([sys.executable, '-c', supervisor_code])
    state = await_file(marker, supervisor)
    try:
        no_start = root / 'must-not-start'
        assert reader.run_supervised([sys.executable, '-c', f"from pathlib import Path; Path({str(no_start)!r}).touch()"], lock, timeout=1) == 75
        assert not no_start.exists()
        supervisor.terminate()
        assert supervisor.wait(timeout=5) == 143
        await_stopped(state['pid']); await_stopped(state['child'])
    finally:
        if supervisor.poll() is None: supervisor.kill(); supervisor.wait()
    assert reader.run_supervised([sys.executable, '-c', 'pass'], lock, timeout=2) == 0

    # Worker deadline remains effective if the supervisor has gone away.
    worker = subprocess.Popen([sys.executable, '-c', IMPORT + 'm.install_worker_deadline(0.2); import time; time.sleep(60)'], start_new_session=True)
    assert worker.wait(timeout=3) == -signal.SIGKILL

    # A forcibly killed supervisor cannot release a still-running worker's
    # inherited lock. Its independent deadline releases it when the worker dies.
    marker.unlink()
    worker_code = IMPORT + 'm.install_worker_deadline(1.5); ' + \
        f"import os,json,time; m.Path({str(marker)!r}).write_text(json.dumps({{'pid':os.getpid(),'scratch':os.environ['TMPDIR']}})); time.sleep(60)"
    supervisor_code = IMPORT + f"raise SystemExit(m.run_supervised({[sys.executable, '-c', worker_code]!r},m.Path({str(lock)!r}),timeout=10))"
    supervisor = subprocess.Popen([sys.executable, '-c', supervisor_code])
    state = await_file(marker, supervisor)
    supervisor.kill(); supervisor.wait(timeout=3)
    assert reader.run_supervised([sys.executable, '-c', 'pass'], lock, timeout=1) == 75
    await_stopped(state['pid'])
    assert reader.run_supervised([sys.executable, '-c', 'pass'], lock, timeout=1) == 0
    shutil.rmtree(state['scratch'])  # Synthetic supervisor could not clean up.

    # Restarting the owner must also stop the supervised reader, not orphan it.
    marker.unlink()
    worker = f"from pathlib import Path; import os,json,time; Path({str(marker)!r}).write_text(json.dumps({{'pid':os.getpid()}})); time.sleep(60)"
    supervisor_code = IMPORT + f"raise SystemExit(m.run_supervised({[sys.executable, '-c', worker]!r},m.Path({str(lock)!r}),timeout=10))"
    owner = subprocess.Popen([sys.executable, '-c', f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{supervisor_code!r}]); time.sleep(60)"])
    try:
        state = await_file(marker, owner)
        owner.terminate(); owner.wait(timeout=3)
        await_stopped(state['pid'])
    finally:
        if owner.poll() is None: owner.kill(); owner.wait()

    # Exercise the real CLI/worker with an entirely synthetic collector.
    fake = root / 'opsbot'
    (fake / 'scripts').mkdir(parents=True)
    (fake / 'scripts' / 'opsbot_paths.py').write_text('')
    fake_collector = fake / 'scripts' / 'collect_junkware_daily.py'
    output = root / 'verified.json'
    base = f"from pathlib import Path\nSTORAGE_STATE_PATH=Path({str(root / 'empty-auth.json')!r})\n_PERSIST_STORAGE_STATE=True\n"
    result = {'collection_timestamp':'2026-09-09T17:00:00Z','appointment_rows':[], 'cancel_rows':[], 'verification':{'all_territories_verified':True,'verified_markets':['synthetic-market'],'territories':[]}}
    fake_collector.write_text(base + f'def collect_attendance_source(day):\n    return {result!r}\ndef close_browser():\n    pass\n')
    command = [sys.executable, str(SCRIPT), '--date', '2026-09-09', '--opsbot-dir', str(fake), '--output', str(output)]
    assert subprocess.run(command, timeout=5).returncode == 0
    verified = output.read_bytes()
    assert json.loads(verified)['markets_scraped'] == ['synthetic-market']
    result['verification']['all_territories_verified'] = False
    fake_collector.write_text(base + f'def collect_attendance_source(day):\n    return {result!r}\ndef close_browser():\n    pass\n')
    assert subprocess.run(command, timeout=5, stderr=subprocess.PIPE).returncode != 0
    assert output.read_bytes() == verified, 'Incomplete collection must preserve the verified cache'
    result['verification']['all_territories_verified'] = True
    fake_collector.write_text(base + f'def collect_attendance_source(day):\n    return {result!r}\ndef close_browser():\n    while True: pass\n')
    assert reader.run_supervised(command + ['--worker'], lock, timeout=0.5) == 124
    assert output.read_bytes() == verified, 'Hung cleanup must not corrupt a verified snapshot'

print('Requested schedule lifecycle passed: deadline, hung cleanup, browser children, process lock, owner restart, worker fallback, scratch cleanup, and exit codes. Synthetic only.')
