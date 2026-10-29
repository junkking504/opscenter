"""Offline run of auto-ship.sh; gh, git and ship.sh are stubbed."""
import os
from pathlib import Path
import subprocess
import tempfile

source = Path('deploy/macmini/auto-ship.sh')

def run(mode, extra=None):
    with tempfile.TemporaryDirectory(prefix='auto-ship-') as temporary:
        root = Path(temporary)
        bindir, config, work = root / 'bin', root / 'config', root / 'work'
        scripts = work / 'deploy/macmini'
        for folder in (bindir, config, scripts):
            folder.mkdir(parents=True)
        log = root / 'calls.log'
        stub = '''#!/usr/bin/python3
import os,sys
from pathlib import Path
name=Path(sys.argv[0]).name
args=sys.argv[1:]
with open(os.environ['TEST_LOG'],'a') as f:f.write(name+' '+' '.join(args)+'\\n')
if name=='gh' and args[:2]==['pr','list']:print('' if os.environ['MODE']=='none' else '42')
if name=='gh' and args[:2]==['pr','view']:print('MERGED' if os.environ['MODE']=='deploy-fails' else 'OPEN')
'''
        for name in ('gh', 'git'):
            (bindir / name).write_text(stub)
            (bindir / name).chmod(0o755)
        ship = '''#!/bin/bash
echo "ship called $1" >> "$TEST_LOG"
case "$MODE" in
  ci-pending) echo "ship stopped: CI is not fully green (1 checks pending or failing)" >&2; exit 1;;
  gate) echo "ship stopped: review approval is missing; production was not changed" >&2; exit 1;;
  deploy-fails) echo "Deploying abc" ; exit 1;;
esac
exit 0
'''
        (scripts / 'ship.sh').write_text(ship)
        (scripts / 'ship.sh').chmod(0o755)
        env = dict(os.environ, AUTO_SHIP_EXTRA_PATH=str(bindir), MODE=mode, TEST_LOG=str(log),
                   AUTO_SHIP_CONFIG_DIR=str(config), AUTO_SHIP_WORKTREE=str(work),
                   AUTO_SHIP_DEPLOY_LOCK=str(root / 'no-lock'), AUTO_SHIP_MIN_INTERVAL_SECONDS='3600')
        if extra:
            extra(root, config, env)
        result = subprocess.run(['bash', str(source.resolve())], env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        return (log.read_text() if log.exists() else ''), (config / 'auto-ship.last').exists()

calls, stamp = run('none')
assert 'ship called' not in calls

calls, stamp = run('ok')
assert 'ship called 42' in calls and 'pr edit 42 --remove-label ready-to-ship' in calls and 'merged and deployed' in calls
assert stamp

calls, stamp = run('ci-pending')
assert 'ship called 42' in calls and '--remove-label' not in calls and not stamp

calls, stamp = run('gate')
assert '--remove-label ready-to-ship' in calls and '--add-label ship-failed' in calls and 'review approval is missing' in calls

calls, stamp = run('deploy-fails')
assert '--add-label ship-failed' in calls and 'PR state: MERGED' in calls

calls, _ = run('ok', lambda root, config, env: (config / 'auto-ship.off').write_text(''))
assert 'ship called' not in calls

def recent(root, config, env):
    (config / 'auto-ship.last').write_text('')
calls, _ = run('ok', recent)
assert 'ship called' not in calls, 'one release per hour'

def locked(root, config, env):
    (root / 'no-lock').mkdir()
calls, _ = run('ok', locked)
assert 'ship called' not in calls, 'controller deploy lock'
print('auto-ship checks passed')
