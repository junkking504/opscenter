import importlib.util
import json
import pathlib
import subprocess
import tempfile
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location('runner', pathlib.Path(__file__).with_name('run-operational-agents.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp)
    called = []
    def run(command, **kwargs):
        stage = command[-1]
        called.append(stage)
        assert kwargs['timeout'] == 20
        if stage == 'shared':
            raise subprocess.TimeoutExpired(command, 20)
        if stage == 'trucks':
            return SimpleNamespace(returncode=1)
        return SimpleNamespace(returncode=0)
    original_clock = runner.time.monotonic
    ticks = iter([0, 12, 20, 21, 30, 31])
    runner.time.monotonic = lambda: next(ticks)
    try:
        assert runner.execute_stages(root, root, '2026-09-17', {}, 1, run) == 124
    finally:
        runner.time.monotonic = original_clock
    assert called == ['shared', 'trucks', 'hierarchy']
    state = json.loads((root/'worker-status.json').read_text())
    assert [s['status'] for s in state['stages'].values()] == ['timed_out', 'failed', 'ok']
    assert state['finishedAt'] and all('durationMs' in s for s in state['stages'].values())
    assert state['stages']['shared']['durationMs'] == 12000
    assert state['stages']['shared']['diagnostics']['stage'] == 'shared'
    assert 'cpuUserMs' in state['stages']['shared']['diagnostics']
    assert 'diagnostics' not in state['stages']['trucks']
    assert len(state['samples']) == 1 and state['samples'][0]['stages']['shared']['durationMs'] == 12000
    assert (root/'worker-status.json').stat().st_mode & 0o777 == 0o600
    assert not list(root.glob('*.tmp'))
print('Runner passed: isolated timeout/failure, independent later stages and durable private execution evidence.')
with tempfile.TemporaryDirectory() as temp:
    home = pathlib.Path(temp)
    source = home/'Library/Application Support/OpsCenter/production.env'
    source.parent.mkdir(parents=True)
    source.write_text('OPSCENTER_KERNEL_ENABLED=1\nOPSCENTER_MISSION_CONTROL_DATABASE_URL="postgresql://fixture@localhost/fixture"\nSECRET_TOKEN=must-not-load\n')
    isolated = runner.load_runtime_env({}, home/'isolated-data', home)
    assert not isolated
    configured = runner.load_runtime_env({}, home/'.openclaw/workspace/opsbot/data', home)
    assert configured['OPSCENTER_RUNTIME'] == 'MISSION_CONTROL'
    assert configured['OPSCENTER_KERNEL_ENABLED'] == '1'
    assert 'SECRET_TOKEN' not in configured
    explicit = runner.load_runtime_env({'OPSCENTER_KERNEL_ENABLED':'0'}, home/'.openclaw/workspace/opsbot/data', home)
    assert explicit['OPSCENTER_KERNEL_ENABLED'] == '0'
print('Runner environment passed: existing kernel configuration only; isolated data cannot inherit production DB.')
