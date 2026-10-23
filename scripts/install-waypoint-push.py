"""Explicit crew-feature activation after controller deployment, never part of deploy."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

source = Path(__file__).resolve().parent.parent
active = Path('/Users/missioncontrol/opscenter-v2/opscenter').resolve()
if source != active:
    raise SystemExit('Install from the reviewed active immutable release after deployment.')
state = Path.home() / 'Library/Application Support/OpsCenter/waypoint-push'
agent = Path.home() / 'Library/LaunchAgents/com.opscenter.waypoint-push.plist'
if sys.argv[1:] != ['--apply']:
    print('No changes; explicit --apply is required for activation.')
    raise SystemExit(0)
if state.exists() or agent.exists():
    raise SystemExit('Existing installation requires explicit reconciliation; not overwritten.')
state.mkdir(mode=0o700)
shutil.copy2(source / 'scripts/run-waypoint-push.py', state / 'run-waypoint-push.py')
(state / 'run-waypoint-push.py').chmod(0o600)
config = state / 'config.json'
fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd,'w') as output:
    output.write(json.dumps({'schema':1,'enabled':True})+'\n')
    output.flush()
    os.fsync(output.fileno())
shutil.copy2(source / 'launchd/com.opscenter.waypoint-push.plist', agent)
subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(agent)],check=True)
print('Waypoint crew sender installed and enabled. Crew browser permission is still required.')
