#!/usr/bin/env python3
"""Read-only VPS continuity observer. No repairs, messages, or provider calls."""
import concurrent.futures
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = Path('/home/opscenter/continuity-monitor/state')
RECEIPT = Path('/srv/opscenter/continuity-20260912/status/database-sync.json')
CONTAINER = 'opscenter-continuity-app-1'
SHA = re.compile(r'^[a-f0-9]{40}$')
MAX_BYTES = 262144


def stamp(now=None):
    return datetime.fromtimestamp(time.time() if now is None else now, timezone.utc).isoformat()


def age(value, now):
    try:
        delta = now - datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
        return delta if delta >= 0 else None
    except (ValueError, TypeError, AttributeError):
        return None


def read_json(file):
    if file.stat().st_size > MAX_BYTES:
        raise ValueError('Snapshot too large')
    return json.loads(file.read_text())


def atomic(file, value):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = file.with_suffix('.pending')
    with temporary.open('w') as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(file)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe(url, html=False):
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'OpsCenter-Continuity-Monitor', 'Accept': 'text/html' if html else 'application/json'})
        try:
            response = urllib.request.build_opener(NoRedirect).open(request, timeout=12)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                return None
            if html:
                return {'code': response.status, 'loginForm': b'name="username"' in body and b'name="password"' in body and b'/api/auth/login' in body}
            value = json.loads(body)
            return value if isinstance(value, dict) else None
    except Exception:
        return None


def inspect_app():
    try:
        # Select fields inside Docker; never print container env or credentials.
        result = subprocess.run(['docker', 'inspect', CONTAINER, '--format',
            '{{json .State.Running}} {{json .Config.Labels}}'], capture_output=True, text=True, check=True, timeout=10).stdout
        running, labels = result.split(' ', 1)
        revision = json.loads(labels).get('org.opencontainers.image.revision')
        return {'running': json.loads(running), 'revision': revision if isinstance(revision, str) and SHA.fullmatch(revision) else None}
    except Exception:
        return None


def checks(inputs, now):
    rows = []
    def add(key, title, status, evidence, next_step):
        rows.append(dict(key=key, title=title, status=status, evidence=evidence, nextStep=next_step))
    primary = inputs.get('primary') or {}
    current = age(primary.get('observedAt'), now)
    fresh = current is not None and current <= 180
    add('primary-evidence', 'Mission Control monitoring link', 'ok' if fresh else 'unknown',
        'Primary release and publication evidence is current.' if fresh else 'Primary evidence is missing, future-dated, or older than 3 minutes.',
        'Check Mission Control and its continuity monitor collector; an unreachable Mac does not prove its writers stopped.')
    app = inputs.get('app') or {}
    expected, actual = primary.get('release'), app.get('revision')
    known = fresh and isinstance(expected, str) and SHA.fullmatch(expected) and isinstance(actual, str) and SHA.fullmatch(actual)
    add('version', 'Standby application version', 'ok' if known and expected == actual else 'warn' if known else 'unknown',
        f'Primary {expected[:8]} · standby {actual[:8]}.' if known else 'Current release comparison is unavailable.',
        'Build and verify the VPS image from the active primary release; file and database copies do not deploy application code.')
    health = inputs.get('standby') or {}
    kernel = health.get('platformKernel') or {}
    ready = app.get('running') is True and health.get('runtime') == 'VPS' and kernel.get('healthy') is True and kernel.get('databaseName') == 'opscenter_recovery_20260914' and health.get('assignmentStoreWritable') is False and health.get('operatorStateWritable') is False
    add('standby', 'Read-only standby readiness', 'ok' if ready else 'warn' if health and app else 'unknown',
        'Independent app and database respond with read-only operational storage.' if ready else 'Standby process, database identity, or read-only readiness is unverified.',
        'Inspect the VPS app, ingress, database and mounts. Preserve read-only storage; do not promote a writer to clear this alert.')
    gateway = inputs.get('gateway') or {}
    gateway_ready = gateway.get('mode') in ('primary', 'read-only-recovery') and gateway.get('standbyReady') is True
    add('gateway', 'Recovery gateway', 'ok' if gateway_ready else 'warn' if gateway else 'unknown',
        'Gateway responds and reports the standby ready.' if gateway_ready else 'Recovery gateway is unavailable or has not verified standby readiness.',
        'Inspect the dedicated continuity gateway and its configured origins; preserve write denial and request replay protections.')
    origin = inputs.get('origin') or {}
    origin_ready = origin.get('runtime') == 'MISSION_CONTROL' and (origin.get('platformKernel') or {}).get('healthy') is True
    add('primary-origin', 'Primary origin through VPS relay', 'ok' if origin_ready else 'warn',
        'Mission Control application/database responds through the VPS relay.' if origin_ready else 'Primary origin is unavailable or its database is unhealthy; recovery may be required.',
        'Check primary health and the owned relay separately. Verify any uncertain business submission before retrying.')
    login, public = inputs.get('login') or {}, inputs.get('public') or {}
    public_ready = login.get('code') == 200 and login.get('loginForm') is True and public.get('runtime') in ('MISSION_CONTROL', 'VPS') and (public.get('platformKernel') or {}).get('healthy') is True
    add('public', 'Public access from VPS', 'ok' if public_ready else 'warn' if login or public else 'unknown',
        ('Public login form and structured database readiness passed from outside Mission Control.' if public_ready else
         'Primary works through the relay, but public access is failing or unverified.' if origin_ready else 'Public login or structured readiness is failing or unavailable.'),
        'Inspect Cloudflare ingress, connector health and the public origin. A local healthy response cannot clear a public-path failure.')
    publication = primary.get('publication') or {}
    for key, title, value in [('files', 'Operational file backup', publication.get('fileLastSuccessAt')),
                              ('statements', 'Accounting statement backup', publication.get('financialStatementsSyncedAt')),
                              ('database', 'Standby database snapshot', (inputs.get('receipt') or {}).get('snapshotAt'))]:
        elapsed = age(value, now)
        failed = publication.get('status') == 'failed' or (key == 'files' and publication.get('fileSyncExitCode') not in (None, 0))
        status = 'unknown' if not fresh or elapsed is None else 'warn' if elapsed > 600 or failed else 'ok'
        add(key, title, status, f'Last successful snapshot: {value or "unknown"}.' + (' Latest publication failed.' if failed else ''),
            'Inspect the last publisher and file-copy receipts; repair the cause and verify a fresh successful copy. Do not reset history or overwrite the primary.')
    disk = inputs.get('disk') or {}
    free, total = disk.get('free'), disk.get('total')
    valid_disk = isinstance(free, int) and isinstance(total, int) and total > 0 and 0 <= free <= total
    used = round((1 - free / total) * 100) if valid_disk else None
    add('disk', 'VPS storage capacity', 'unknown' if not valid_disk else 'warn' if free < 5 * 1024**3 or used >= 90 else 'ok',
        f'{used}% used · {free / 1024**3:.1f} GiB available.' if valid_disk else 'VPS filesystem capacity could not be read.',
        'Inspect bounded build-cache and release retention. Preserve databases, operational snapshots and rollback images.')
    return rows


def reconcile(previous, rows, now):
    if previous is not None and (previous.get('version') != 1 or not isinstance(previous.get('incidents'), list) or not isinstance(previous.get('receipts'), list)):
        raise ValueError('Invalid monitor ledger; preserve it for review')
    state = previous or {'version': 1, 'incidents': [], 'receipts': []}
    elapsed = age(state.get('checkedAt'), now)
    if state.get('checkedAt') and (elapsed is None or elapsed < 45):
        return state
    at = stamp(now)
    for row in rows:
        incident = next((item for item in state['incidents'] if item['key'] == row['key']), None)
        bad = row['status'] != 'ok'
        if not incident and not bad:
            continue
        if not incident:
            incident = dict(key=row['key'], firstSeenAt=at, lastSeenAt=at, status='confirming', badChecks=0, goodChecks=0, occurrences=1, resolvedAt=None)
            state['incidents'].append(incident)
        if bad:
            if incident['status'] == 'resolved':
                incident.update(status='confirming', badChecks=0, firstSeenAt=at, resolvedAt=None, occurrences=incident['occurrences'] + 1)
            incident.update(lastSeenAt=at, goodChecks=0, badChecks=incident['badChecks'] + 1)
            if incident['badChecks'] >= 2 and incident['status'] == 'confirming':
                incident['status'] = 'open'
                state['receipts'].append(dict(at=at, key=row['key'], event='Confirmed on two independent observations'))
        else:
            incident.update(badChecks=0, goodChecks=incident['goodChecks'] + 1)
            if incident['goodChecks'] >= 3 and incident['status'] != 'resolved':
                incident.update(status='resolved', resolvedAt=at)
                state['receipts'].append(dict(at=at, key=row['key'], event='Cleared on three successful observations'))
    state.update(checkedAt=at, checks=rows, status='attention' if any(r['status'] != 'ok' for r in rows) or any(i['status'] != 'resolved' for i in state['incidents']) else 'ready')
    state['receipts'] = state['receipts'][-100:]
    return state


def exchange():
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384:
        raise ValueError('Primary evidence too large')
    value = json.loads(raw)
    if value.get('version') != 1 or not SHA.fullmatch(str(value.get('release', ''))) or age(value.get('observedAt'), time.time()) is None or age(value.get('observedAt'), time.time()) > 60:
        raise ValueError('Invalid primary evidence')
    publication = value.get('publication') or {}
    safe = {key: publication.get(key) for key in ('status', 'lastSuccessAt', 'fileLastSuccessAt', 'financialStatementsSyncedAt', 'fileSyncExitCode')}
    atomic(ROOT / 'primary.json', dict(version=1, observedAt=value['observedAt'], release=value['release'], publication=safe))
    print(json.dumps(read_json(ROOT / 'monitor.json')))


def observe():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (ROOT / 'observer.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        urls = {'gateway': 'http://127.0.0.1:3002/api/continuity/status', 'origin': 'http://127.0.0.1:3000/api/health', 'standby': 'http://127.0.0.1:3001/api/health',
                'public': 'https://ops.junk-king.app/api/health', 'login': 'https://ops.junk-king.app/login'}
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            work = {key: pool.submit(probe, url, key == 'login') for key, url in urls.items()}
            app = pool.submit(inspect_app)
            inputs = {key: item.result() for key, item in work.items()}
            inputs['app'] = app.result()
        for key, file in [('primary', ROOT / 'primary.json'), ('receipt', RECEIPT)]:
            try:
                inputs[key] = read_json(file)
            except (OSError, ValueError):
                inputs[key] = None
        stat = os.statvfs('/srv/opscenter')
        inputs['disk'] = {'free': stat.f_bavail * stat.f_frsize, 'total': stat.f_blocks * stat.f_frsize}
        previous = read_json(ROOT / 'monitor.json') if (ROOT / 'monitor.json').exists() else None
        atomic(ROOT / 'monitor.json', reconcile(previous, checks(inputs, time.time()), time.time()))
        print('Continuity observation recorded; no repairs or external messages performed.')


if __name__ == '__main__':
    try:
        exchange() if '--exchange' in sys.argv else observe()
    except Exception:
        print('Continuity monitor evidence or ledger unavailable; review required.', file=sys.stderr)
        raise SystemExit(1)
