"""Fixed, start-only recovery. No model input, shell, service selection or data repair."""
import contextlib
import datetime
import errno
import json
import os
import pathlib
import re
import socket
import subprocess
import time
import urllib.request
import urllib.error
from zoneinfo import ZoneInfo

LABEL = 'com.openclaw.opscenter'


def atomic_json(target, value):
    temporary = target.with_name(target.name + '.%s.tmp' % os.getpid())
    with open(temporary, 'w') as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, target)
    fd = os.open(target.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def enabled(directory):
    try:
        policy = json.loads((directory / 'recovery-policy.json').read_text())
        return policy.get('version') == 1 and policy.get('enabled') is True
    except (OSError, ValueError, AttributeError):
        return False


def initial_state():
    return dict(version=1, checkedAt=0, status='Waiting for observation', badChecks=0,
                goodChecks=0, attempted=False, attempts=[], receipts=[])


def read_state(directory):
    try:
        state = json.loads((directory / 'recovery.json').read_text())
    except FileNotFoundError:
        # A separate sentinel prevents a lost ledger from silently resetting limits.
        if (directory / 'recovery-initialized').exists():
            raise ValueError('Recovery ledger missing')
        return initial_state()
    assert state['version'] == 1 and type(state['attempted']) is bool
    assert type(state['status']) is str
    for key in ('checkedAt', 'badChecks', 'goodChecks'):
        assert type(state[key]) is int and state[key] >= 0
    assert type(state['attempts']) is list and all(type(x) is int and x > 0 for x in state['attempts'])
    assert type(state['receipts']) is list and all(type(x['at']) is int and type(x['event']) is str for x in state['receipts'])
    return state


class Runtime:
    def __init__(self):
        self.root = pathlib.Path.home() / 'opscenter-v2'
        self.app = self.root / 'opscenter'
        self.target = 'gui/%s/%s' % (os.getuid(), LABEL)

    def command(self, args):
        return subprocess.run(args, capture_output=True, text=True, timeout=5)

    def inspect(self):
        """Unknown evidence blocks action. A live PID or occupied port always blocks."""
        service = self.command(['/bin/launchctl', 'print', self.target])
        if service.returncode:
            return 'blocked', 'Service is unloaded or unavailable; manual review required'
        if re.search(r'^\s*pid = [1-9][0-9]*\s*$', service.stdout, re.M):
            return 'running', 'Process is running; no automatic restart allowed'
        if not re.search(r'^\s*state = not running\s*$', service.stdout, re.M):
            return 'blocked', 'Service state is not confirmed stopped'
        # Require the registered production wrapper, not merely a matching label.
        if str(self.app / 'scripts/run_opscenter.sh') not in service.stdout:
            return 'blocked', 'Registered service does not match the production wrapper'
        disabled = self.command(['/bin/launchctl', 'print-disabled', 'gui/%s' % os.getuid()])
        match = re.search(r'"' + re.escape(LABEL) + r'"\s*=>\s*(\w+)', disabled.stdout)
        if disabled.returncode or not match or match.group(1) not in ('enabled', 'false'):
            return 'blocked', 'Service is disabled or enablement is unverified'
        try:
            with socket.create_connection(('127.0.0.1', 3000), timeout=1):
                return 'blocked', 'Port 3000 is occupied; no duplicate process allowed'
        except OSError as error:
            if error.errno != errno.ECONNREFUSED:
                return 'blocked', 'Local listener state is uncertain'
        pidfile = pathlib.Path('/tmp/com.openclaw.opscenter.lock/pid')
        if pidfile.parent.exists() and not pidfile.exists():
            return 'blocked', 'Wrapper lock has no PID; manual review required'
        if pidfile.exists():
            try:
                pid = int(pidfile.read_text().strip())
                if pid <= 0:
                    return 'blocked', 'Wrapper lock needs review'
                os.kill(pid, 0)
                return 'blocked', 'Existing wrapper process is still alive'
            except ProcessLookupError:
                pass  # The existing wrapper owns stale-lock handling.
            except (OSError, ValueError):
                return 'blocked', 'Wrapper lock needs review'
        # Known write locks and detached writer processes survive a server exit.
        data = pathlib.Path(os.environ.get('OPSBOT_DATA_DIR', str(pathlib.Path.home() / '.openclaw/workspace/opsbot/data')))
        roots = {data, self.app / 'data'}
        patterns = ('job-route-assignments/*.lock', 'job-route-assignments/.junkware-assignment-sync.lock',
                    'job-route-assignments/.junkware-appointment-sync-locks/*.lock',
                    'job-route-assignments/.schedule-operation-locks/*.lock',
                    'appointment-creations/.junkware-create.lock')
        if pathlib.Path('/tmp/com.openclaw.opscenter.junkware-truck-record.lock').exists() or any(
                list(root.glob(pattern)) for root in roots for pattern in patterns):
            return 'blocked', 'Operational write lock exists; manual review required'
        processes = self.command(['/bin/ps', '-axo', 'command='])
        if processes.returncode or re.search(r'(sync-junkware-truck-assignment|sync-junkware-appointment|create-junkware-appointment|upload-junkware-truck-record)', processes.stdout):
            return 'blocked', 'Operational writer may still be active'
        return 'stopped', 'Stopped process and closed listener confirmed'

    @contextlib.contextmanager
    def deployment_guard(self):
        lock = self.root / '.deploy-lock'
        try:
            lock.mkdir(mode=0o700)
        except FileExistsError:
            yield False
            return
        try:
            (lock / 'owner').write_text('pid=%s\npurpose=opscenter-process-recovery\n' % os.getpid())
            yield True
        finally:
            (lock / 'owner').unlink(missing_ok=True)
            lock.rmdir()

    def deployment_active(self):
        return (self.root / '.deploy-lock').exists()

    def release(self):
        target = self.app.resolve(strict=True)
        if target.parent != self.root / 'releases' or not re.fullmatch('[0-9a-f]{40}', target.name):
            raise ValueError('Active release is not an immutable production release')
        return str(target)

    def start(self):
        # Deliberately no -k: a racing natural launchd recovery must never be killed.
        return self.command(['/bin/launchctl', 'kickstart', self.target]).returncode == 0

    def healthy(self):
        if self.inspect()[0] != 'running':
            return False
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        request = urllib.request.Request('http://127.0.0.1:3000/login', headers={'Host': 'ops.junk-king.app'})
        try:
            with opener.open(request, timeout=2) as response:
                # Redirected login is not proof of the local application.
                return response.status == 200 and response.url == request.full_url
        except (OSError, urllib.error.URLError):
            return False

    def verify(self):
        consecutive = 0
        for _ in range(5):
            time.sleep(5)
            consecutive = consecutive + 1 if self.healthy() else 0
            if consecutive >= 3:
                return True
        return False


def tick(directory, runtime=None, now=None):
    """Caller must hold worker.lock. All tests use an isolated injected runtime."""
    runtime = runtime or Runtime()
    now = int(time.time()) if now is None else now
    state = read_state(directory)  # Invalid/missing initialized ledger fails closed.

    def save(status):
        if state['status'] != status:
            state['receipts'].append(dict(at=now, event=status))
        state['status'] = status
        state['receipts'] = state['receipts'][-100:]
        state['checkedAt'] = now
        atomic_json(directory / 'recovery.json', state)
        atomic_json(directory / 'recovery-initialized', {'version': 1})
        return state

    if not enabled(directory):
        state['badChecks'] = state['goodChecks'] = 0
        return save('Paused; automatic process recovery is off')
    elapsed = now - state['checkedAt']
    if state['checkedAt'] and elapsed < 45:
        return state
    if elapsed > 150:
        state['badChecks'] = state['goodChecks'] = 0
    if runtime.deployment_active():
        state['badChecks'] = state['goodChecks'] = 0
        return save('Blocked while a deployment or recovery holds the deployment lock')
    kind, evidence = runtime.inspect()
    if kind == 'running':
        state['badChecks'] = 0
        if runtime.healthy():
            state['goodChecks'] += 1
            if state['goodChecks'] >= 3:
                state['attempted'] = False
            return save('Process and login responding; monitoring')
        state['goodChecks'] = 0
        return save('Running process needs review; automatic restart is prohibited')
    state['goodChecks'] = 0
    if kind != 'stopped':
        state['badChecks'] = 0
        return save(evidence)
    state['badChecks'] += 1
    if state['attempted']:
        return save('Attempt already used for this outage; manual review required')
    if state['badChecks'] < 3:
        return save('Confirming stopped process (%s/3)' % state['badChecks'])
    day = lambda timestamp: datetime.datetime.fromtimestamp(timestamp, ZoneInfo('America/Chicago')).date()
    if sum(day(x) == day(now) for x in state['attempts']) >= 2:
        return save('Daily limit reached (2 attempts); manual review required')
    if state['attempts'] and now - max(state['attempts']) < 1800:
        return save('Recovery cooldown active (30 minutes)')
    release = runtime.release()
    with runtime.deployment_guard() as acquired:
        if not acquired:
            return save('Deployment started; recovery deferred')
        if not enabled(directory) or runtime.release() != release or runtime.inspect()[0] != 'stopped':
            state['badChecks'] = 0
            return save('Safety conditions changed; no start attempted')
        state['attempted'] = True
        state['attempts'].append(now)
        save('Start attempt reserved; outcome pending')  # Persist BEFORE command.
        try:
            started = runtime.start()
            verified = started and runtime.verify()
        except (OSError, subprocess.SubprocessError):
            verified = False
        return save('Process recovery verified: process and login responding; source and workflow checks remain separate'
                    if verified else 'Start outcome unverified; attempt consumed; manual review required')
