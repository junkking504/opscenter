#!/usr/bin/python3
"""Bounded, crash-safe ownership for the shared and per-truck local operational agents."""
import fcntl
import json
import os
import pathlib
import re
import resource
import shlex
import subprocess
import sys
import time
import tempfile
from datetime import datetime, timezone


def stamp():
    return datetime.now(timezone.utc).isoformat()


def load_runtime_env(env, root, home=None):
    """Read only the existing app's kernel configuration; never source shell code.

    Isolated data roots do not inherit the production database. Preview callers
    may explicitly supply OPSCENTER_ENV_FILE and OPSCENTER_RUNTIME.
    """
    home = home or pathlib.Path.home()
    production_root = home / '.openclaw/workspace/opsbot/data'
    configured = env.get('OPSCENTER_ENV_FILE')
    if not configured and root.resolve() != production_root.resolve():
        return env
    file = pathlib.Path(configured) if configured else home / 'Library/Application Support/OpsCenter/production.env'
    allowed = {'OPSCENTER_RUNTIME', 'OPSCENTER_KERNEL_ENABLED', 'OPSCENTER_MISSION_CONTROL_DATABASE_URL', 'OPSCENTER_PREVIEW_DATABASE_URL', 'OPSCENTER_LIVE_DATABASE_URL'}
    result = dict(env)
    try:
        for line in file.read_text().splitlines():
            key, separator, value = line.partition('=')
            if separator and key.strip() in allowed:
                parsed = shlex.split(value, comments=True)
                if len(parsed) == 1:
                    result.setdefault(key.strip(), parsed[0])
        if not configured and 'OPSCENTER_MISSION_CONTROL_DATABASE_URL' in result:
            result.setdefault('OPSCENTER_RUNTIME', 'MISSION_CONTROL')
    except (OSError, ValueError):
        # Missing configuration is visible as an unavailable queue, not a new DB.
        pass
    return result


def publish(directory, value):
    fd, temporary = tempfile.mkstemp(prefix='worker-status.', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, directory / 'worker-status.json')
        parent = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _json_counts(target, names):
    try:
        if target.stat().st_size > 20 * 1024 * 1024:
            return {'oversized': True}
        value = json.loads(target.read_text())
        result = {}
        for name in names:
            item = value.get(name) if isinstance(value, dict) else None
            if isinstance(item, (list, dict)):
                result[name] = len(item)
        return result
    except (OSError, ValueError, TypeError):
        return {'unavailable': True}


def slow_stage_diagnostics(stage, root, date, before, after):
    """Cheap, local evidence only; never starts a collector or provider call."""
    inputs = {
        'linxup': _json_counts(root / f'history/linxup/linxup_location_{date}.json', ('points',)),
        'shared': _json_counts(root / f'fleet/agents/{date}.json', ('agents',)),
        'trucks': _json_counts(root / f'fleet/truck-agents/{date}.json', ('agents',)),
        'hierarchy': _json_counts(root / 'fleet/agent-hierarchy/state.json', ('feeds', 'issues')),
    }
    raw_rss = after.ru_maxrss
    resident_kb = round(raw_rss / 1024) if sys.platform == 'darwin' else round(raw_rss)
    return {
        'stage': stage,
        'cpuUserMs': max(0, round((after.ru_utime - before.ru_utime) * 1000)),
        'cpuSystemMs': max(0, round((after.ru_stime - before.ru_stime) * 1000)),
        'maxResidentKb': resident_kb,
        'inputCounts': inputs,
    }


def execute_stages(checkout, directory, date, env, lock_fd, run=subprocess.run):
    failures = []
    samples = []
    try:
        previous = json.loads((directory / 'worker-status.json').read_text())
        failures = previous.get('failures', [])[-20:]
        samples = previous.get('samples', [])[-1439:]
    except (OSError, ValueError, TypeError):
        pass
    state = {'version': 1, 'date': date, 'startedAt': stamp(), 'finishedAt': None,
             'failures': failures,
             'samples': samples,
             'stages': {name: {'status': 'pending'} for name in ('shared', 'trucks', 'hierarchy')}}
    result = 0
    for stage in state['stages']:
        started = time.monotonic()
        usage_before = resource.getrusage(resource.RUSAGE_CHILDREN)
        state['stages'][stage] = {'status': 'running', 'startedAt': stamp()}
        publish(directory, state)
        try:
            code = run(['node', '--import', 'tsx', 'scripts/run-operational-agents.ts', date, stage],
                       cwd=checkout, env=env, pass_fds=(lock_fd,), timeout=20, check=False).returncode
            status = 'ok' if code == 0 else 'failed'
        except subprocess.TimeoutExpired:
            code, status = 124, 'timed_out'
            print(f'Operational {stage} assessment exceeded its deadline; prior results retained. Continuing independent stages.', file=sys.stderr)
        except OSError:
            code, status = 1, 'failed'
        duration = round((time.monotonic()-started)*1000)
        state['stages'][stage].update(status=status, exitCode=code, finishedAt=stamp(), durationMs=duration)
        if duration >= 10_000:
            state['stages'][stage]['diagnostics'] = slow_stage_diagnostics(stage, directory.parent.parent, date, usage_before, resource.getrusage(resource.RUSAGE_CHILDREN))
        if code:
            state['failures'] = (state['failures'] + [dict(stage=stage, **state['stages'][stage])])[-20:]
        print(json.dumps({'agentStage': stage, **state['stages'][stage]}), flush=True)
        publish(directory, state)
        result = result or code
    state['finishedAt'] = stamp()
    state['samples'] = (state['samples'] + [{
        'startedAt': state['startedAt'], 'finishedAt': state['finishedAt'],
        'stages': {name: {'status': value['status'], 'durationMs': value.get('durationMs')} for name, value in state['stages'].items()},
    }])[-1440:]
    publish(directory, state)
    return result


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
        env = dict(os.environ, OPSCENTER_DATA_DIR=str(root), OPSBOT_DATA_DIR=str(root), OPSCENTER_AGENT_LOCK_HELD='1')
        env = load_runtime_env(env, root)
        return execute_stages(checkout, directory, date, env, lock.fileno())


if __name__ == '__main__':
    sys.exit(main())
