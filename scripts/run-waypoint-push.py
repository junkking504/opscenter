"""Private local launcher; existing production configuration, dedicated sender only."""
import importlib.util
import os
import json
import shlex
import re
from pathlib import Path


def build_environment(app, config):
    spec = importlib.util.spec_from_file_location('push_supervisor', app / 'scripts/supervise-web-push.py')
    supervisor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(supervisor)
    # Daily crew eligibility needs the same roster as the web process, but never
    # its login secrets, payroll credentials or customer/provider credentials.
    supervisor.ALLOWED |= {'OPS_CREW_ROSTER_JSON', 'OPS_WAYPOINT_CREW_EXTRA_NAMES_JSON', 'OPSBOT_DATA_DIR', 'OPSCENTER_DATA_DIR', 'OPS_CREW_PHONE_DIR', 'OPS_CREW_DISPATCH_DIR', 'SCHEDULE_STOP_ORDER_DIR', 'JOB_ROUTE_ASSIGNMENTS_FILE'}
    env = supervisor.environment(config)
    # The web launcher reads shell-quoted configuration. Decode only these
    # JSON arrays without executing shell syntax (including substitutions).
    for line in supervisor.private_read(config).splitlines():
        key, separator, value = line.partition('=')
        key = key.strip()
        if not separator or key not in {'OPS_CREW_ROSTER_JSON', 'OPS_WAYPOINT_CREW_EXTRA_NAMES_JSON'}:
            continue
        value = value.strip()
        if not value:
            continue
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            tokens = shlex.split(value)
            if len(tokens) != 1:
                raise ValueError('Invalid Waypoint crew configuration')
            parsed = json.loads(tokens[0])
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        if not isinstance(parsed, list):
            raise ValueError('Invalid Waypoint crew configuration')
        env[key] = json.dumps(parsed)
    env['OPSCENTER_PROCESS_ROLE'] = 'waypoint-push-dispatcher'
    env.setdefault('OPSBOT_DATA_DIR', str(Path.home() / '.openclaw/workspace/opsbot/data'))
    env.pop('OPSCENTER_WEB_PUSH_PRIVATE_KEY', None)
    return env


def main():
    app = Path('/Users/missioncontrol/opscenter-v2/opscenter').resolve()
    if app.parent != Path('/Users/missioncontrol/opscenter-v2/releases') or not re.fullmatch(r'[a-f0-9]{40}', app.name):
        raise SystemExit('Active release is not a pinned production snapshot.')
    config = Path.home() / 'Library/Application Support/OpsCenter/production.env'
    env = build_environment(app, config)
    os.chdir(app)
    os.execve('/opt/homebrew/bin/node', ['/opt/homebrew/bin/node','--import','tsx','scripts/run-waypoint-push.ts'], env)


if __name__ == '__main__':
    main()
