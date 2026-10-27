import importlib.util
import os
import json
import shlex
from pathlib import Path
import tempfile

source = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('launcher', source / 'scripts/run-waypoint-push.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
with tempfile.TemporaryDirectory() as directory:
    config = Path(directory) / 'production.env'
    config.write_text('OPS_CREW_ROSTER_JSON=[{"employee":"Synthetic crew"}]\nOPS_WAYPOINT_CREW_EXTRA_NAMES_JSON=["Synthetic extra"]\nOPS_CREW_SESSION_SECRET=excluded\nOPENAI_API_KEY=excluded\nWHATSAPP_ACCESS_TOKEN=excluded\nOPSCENTER_WEB_PUSH_PRIVATE_KEY=excluded\nOPS_CREW_PHONE_DIR=/synthetic/phones\nOPSCENTER_DATA_DIR=/synthetic/data\nSCHEDULE_STOP_ORDER_DIR=/synthetic/order\n')
    config.chmod(0o600)
    env = launcher.build_environment(source, config)
    assert json.loads(env['OPS_CREW_ROSTER_JSON']) == [{'employee':'Synthetic crew'}]
    assert env['OPS_WAYPOINT_CREW_EXTRA_NAMES_JSON'] == '["Synthetic extra"]'
    assert env['OPS_CREW_PHONE_DIR'] == '/synthetic/phones'
    assert env['OPSCENTER_DATA_DIR'] == '/synthetic/data'
    assert env['SCHEDULE_STOP_ORDER_DIR'] == '/synthetic/order'
    assert env['OPSCENTER_PROCESS_ROLE'] == 'waypoint-push-dispatcher'
    assert all(key not in env for key in ['OPS_CREW_SESSION_SECRET','OPENAI_API_KEY','WHATSAPP_ACCESS_TOKEN','OPSCENTER_WEB_PUSH_PRIVATE_KEY'])
    # Reproduce production shell escaping of an apostrophe inside roster JSON.
    roster = [{"employee": "O'Example Crew", "username": "synthetic", "active": True}]
    payload = json.dumps(roster)
    for encoded in [payload, shlex.quote(payload), '"' + payload.replace('"', '\\"') + '"']:
        config.write_text('OPS_CREW_ROSTER_JSON=' + encoded + '\n')
        assert json.loads(launcher.build_environment(source, config)['OPS_CREW_ROSTER_JSON']) == roster
    extra = ["O'Example Extra"]
    config.write_text('OPS_WAYPOINT_CREW_EXTRA_NAMES_JSON=' + shlex.quote(json.dumps(extra)) + '\n')
    assert json.loads(launcher.build_environment(source, config)['OPS_WAYPOINT_CREW_EXTRA_NAMES_JSON']) == extra
    marker = Path(directory) / 'must-not-exist'
    literal = [{"employee": '$(touch ' + str(marker) + ')'}]
    config.write_text('OPS_CREW_ROSTER_JSON=' + shlex.quote(json.dumps(literal)) + '\n')
    assert json.loads(launcher.build_environment(source, config)['OPS_CREW_ROSTER_JSON']) == literal
    assert not marker.exists(), 'Configuration must never execute shell substitutions'
    for malformed in ['not-json', "'unterminated", '{}', "'[]' extra"]:
        config.write_text('OPS_CREW_ROSTER_JSON=' + malformed + '\n')
        try:
            launcher.build_environment(source, config)
        except ValueError:
            pass
        else:
            raise AssertionError('Malformed roster must fail closed')
print('PASS launcher: daily crew roster retained; login/provider/private signing secrets excluded. Synthetic configuration only.')
