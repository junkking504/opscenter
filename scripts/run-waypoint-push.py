"""Private local launcher; existing production configuration, dedicated sender only."""
import importlib.util
import os
from pathlib import Path
import subprocess

app = Path('/Users/missioncontrol/opscenter-v2/opscenter').resolve()
spec = importlib.util.spec_from_file_location('push_supervisor', app / 'scripts/supervise-web-push.py')
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)
env = supervisor.environment(supervisor.SUPPORT / 'production.env')
env['OPSCENTER_PROCESS_ROLE'] = 'waypoint-push-dispatcher'
env['OPSBOT_DATA_DIR'] = str(Path.home() / '.openclaw/workspace/opsbot/data')
env.pop('OPSCENTER_WEB_PUSH_PRIVATE_KEY', None)
os.chdir(app)
os.execve('/opt/homebrew/bin/node', ['/opt/homebrew/bin/node','--import','tsx','scripts/run-waypoint-push.ts'], env)
