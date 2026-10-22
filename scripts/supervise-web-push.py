#!/usr/bin/python3
"""Bounded local sender supervision. No startup activation or automatic retry.
Observe mode never retrieves signing material. Lease renewal is lifecycle safety,
not event polling; canonical records and PostgreSQL NOTIFY still drive delivery.
"""
import fcntl
import json
import os
import re
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time
import uuid

HOME = Path('/Users/missioncontrol')
SUPPORT = HOME / 'Library/Application Support/OpsCenter'
STATE = SUPPORT / 'web-push'
APP = HOME / 'opscenter-v2/opscenter'
ALLOWED = {'OPSCENTER_KERNEL_ENABLED', 'OPSCENTER_MISSION_CONTROL_DATABASE_URL',
           'OPS_AUTH_USERNAME', 'OPS_AUTH_ROLE', 'OPS_AUTH_ROLE_BINDINGS', 'OPS_AUTH_DEFAULT_ROLE',
           'OPS_ACCESS_TEAM_DOMAIN', 'OPS_ACCESS_AUD', 'OPS_CREW_ACCESS_TEAM_DOMAIN',
           'OPSCENTER_WEB_PUSH_PUBLIC_KEY', 'OPSCENTER_WEB_PUSH_SUBJECT', 'OPSCENTER_WEB_PUSH_ORIGIN',
           'OPSCENTER_WEB_PUSH_TRUCK_MOVE_OWNER',
           'OPSCENTER_WEB_PUSH_ENABLED', 'OPSCENTER_WEB_PUSH_ENROLLMENT_ENABLED', 'OPSCENTER_WEB_PUSH_ACTIVATED_AT'}

def private_read(file, limit=65536):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > limit:
            raise ValueError('private_file_required')
        return os.read(fd, limit + 1).decode()
    finally:
        os.close(fd)

def environment(file):
    result = {'HOME': str(HOME), 'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', 'NODE_ENV': 'production', 'PYTHONDONTWRITEBYTECODE': '1', 'OPSCENTER_RUNTIME': 'MISSION_CONTROL'}
    seen = set()
    for line in private_read(file).splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, sep, value = line.partition('=')
        key = key.strip()
        if not sep:
            raise ValueError('invalid_configuration')
        if key not in ALLOWED:
            continue
        if key in seen:
            raise ValueError('duplicate_configuration')
        seen.add(key)
        value = value.strip()
        if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
            value = value[1:-1]
        result[key] = value
    return result

def atomic(file, value):
    temporary = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, (json.dumps(value) + '\n').encode()); os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(temporary, file)
    fd = os.open(file.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def signing_key():
    # Only called for an explicitly selected send mode after configuration checks.
    result = subprocess.run(['/usr/bin/security', 'find-generic-password', '-a', 'opscenter', '-s', 'com.opscenter.web-push-vapid-private-key', '-w'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10, check=True)
    value = result.stdout.decode().strip()
    if len(value) != 43 or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-' for c in value):
        raise ValueError('signing_unavailable')
    return value

def supervise(state, env, command, pause, key=signing_key, tick=2.0):
    # Importable for synthetic tests. Production CLI pins all paths and commands.
    info = state.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('private_state_required')
    config = json.loads(private_read(state / 'sender.json', 4096))
    mode = config.get('mode')
    if mode == 'off':
        return 0
    until = config.get('setupUntil')
    ongoing = config.get('ongoing') is True
    maximum = 30 * 86400 if ongoing and mode == 'send' else 3600
    if ongoing and mode != 'send':
        raise ValueError('ongoing_send_only')
    if mode not in ('observe', 'send') or not isinstance(until, (float, int)) or not time.time() < until <= time.time() + maximum:
        raise ValueError('bounded_setup_required')
    if env.get('OPSCENTER_WEB_PUSH_ENABLED') != ('1' if mode == 'send' else '0'):
        raise ValueError('mode_configuration_mismatch')
    journal = state / 'journal'
    info = journal.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('private_journal_required')
    lock_fd = os.open(state / 'supervisor.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    child = None; stopping = False; lease = state / 'capture-lease.json'
    nonce = uuid.uuid4().hex; ready = state / ('ready-' + nonce + '.json')
    old_handlers = {}; owns_lock = False; liveness_write = None
    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        owns_lock = True
        lock_info = os.fstat(lock_fd)
        if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != os.getuid() or lock_info.st_mode & 0o077:
            raise ValueError('private_lock_required')
        # Every new run conservatively marks the gap since its predecessor. Old
        # pending records are recovered, never discarded to make startup green.
        lease.unlink(missing_ok=True)
        pause()
        child_env = dict(env, OPSCENTER_PROCESS_ROLE='push-observer' if mode == 'observe' else 'push-dispatcher', OPSCENTER_WEB_PUSH_CAPTURE='1', OPSCENTER_WEB_PUSH_JOURNAL_DIR=str(journal), OPSCENTER_WEB_PUSH_READY_FILE=str(ready), OPSCENTER_WEB_PUSH_RUN_NONCE=nonce)
        child_env.pop('OPSCENTER_WEB_PUSH_PRIVATE_KEY', None)
        if mode == 'send':
            child_env['OPSCENTER_WEB_PUSH_PRIVATE_KEY'] = key()
        for sig in (signal.SIGTERM, signal.SIGINT):
            old_handlers[sig] = signal.signal(sig, stop)
        # Parent-death detection: this process holds the only write end. Any
        # supervisor exit, including SIGKILL, closes it and the child sees EOF.
        liveness_read, liveness_write = os.pipe()
        child_env['OPSCENTER_WEB_PUSH_PARENT_FD'] = str(liveness_read)
        try:
            child = subprocess.Popen(command, env=child_env, start_new_session=True, pass_fds=(liveness_read,))
        finally:
            os.close(liveness_read)
        child_env.pop('OPSCENTER_WEB_PUSH_PRIVATE_KEY', None)
        startup_deadline = min(until, time.time() + 45)
        was_ready = False
        while not stopping and child.poll() is None and time.time() < until:
            if json.loads(private_read(state / 'sender.json', 4096)) != config:
                break
            ready_now = False
            try:
                item = json.loads(private_read(ready, 1024))
                ready_now = item.get('nonce') == nonce and item.get('pid') == child.pid and item.get('ready') is True
            except (OSError, ValueError):
                pass
            if ready_now:
                was_ready = True
                atomic(lease, {'version': 1, 'mode': mode, 'nonce': nonce, 'expiresAt': min(until, time.time() + 5)})
            elif was_ready or time.time() >= startup_deadline:
                break
            time.sleep(tick)
        return 0 if was_ready else 1
    finally:
        try:
            if owns_lock:
                # A rejected second supervisor must not remove the first lease.
                # Close capture/enrollment/delivery permission before child stop.
                lease.unlink(missing_ok=True)
                try:
                    if child is not None and child.poll() is None:
                        try:
                            os.killpg(child.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        try:
                            child.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid, signal.SIGKILL); child.wait()
                finally:
                    try:
                        if child is not None:
                            pause()
                    finally:
                        ready.unlink(missing_ok=True)
                        # Even failed recovery cannot silently re-enable a run.
                        atomic(state / 'sender.json', {**config, 'mode': 'off'})
        finally:
            if liveness_write is not None:
                os.close(liveness_write)
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)
            os.close(lock_fd)

def main():
    if Path.home() != HOME:
        raise ValueError('mission_control_only')
    env = environment(SUPPORT / 'production.env')
    app = APP.resolve(strict=True)
    if app.parent != HOME / 'opscenter-v2/releases' or not re.fullmatch(r"[a-f0-9]{40}", app.name):
        raise ValueError('active_release_required')
    helper = HOME / '.openclaw/workspace/opsbot/scripts/opscenter_push_journal.py'
    if helper.read_bytes() != (app / 'scripts/opscenter_push_journal.py').read_bytes():
        raise ValueError('helper_version_mismatch')
    env['OPSCENTER_WEB_PUSH_CAPTURE_HELPER'] = str(helper)
    def pause():
        subprocess.run(['/usr/bin/python3', str(helper), '--pause', str(STATE / 'journal')], env={'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, check=True)
    os.chdir(app)
    return supervise(STATE, env, ['/opt/homebrew/bin/node', '--import', 'tsx', 'scripts/run-web-push.ts'], pause)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Web Push supervisor stopped; inspect local readiness and retained evidence. No automatic retry.', file=sys.stderr)
        sys.exit(1)
