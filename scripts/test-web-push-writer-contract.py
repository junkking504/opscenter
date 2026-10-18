#!/usr/bin/env python3
"""Inspect real writer code; execute ONLY extracted pure normalization on fixtures.
No collector imports, browser state, credentials, live payloads or requests.
"""
import argparse
import ast
import hashlib
import importlib.util
import json
import re
from pathlib import Path
from types import SimpleNamespace
import opscenter_push_journal as journal

parser = argparse.ArgumentParser()
parser.add_argument('--opsbot-root', type=Path, required=True)
args = parser.parse_args()
source = (args.opsbot_root / 'scripts/collect_junkware_daily.py').read_text()
tree = ast.parse(source)
normalize = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'normalize_appt')
classification = SimpleNamespace(source_territory='New Orleans', normalized_territory='New Orleans', parish='', classification_source='fixture', classification_confidence='confirmed')
namespace = {'re': re, 'truck_label': lambda value: value, 'parse_details': lambda value: ('Synthetic', '', ''), 'money_text': lambda value: str(value or ''), 'classify_territory': lambda *a, **k: classification}
exec(compile(ast.Module(body=[normalize], type_ignores=[]), '<extracted-pure-normalizer>', 'exec'), namespace)
spec = importlib.util.spec_from_file_location('stream', Path(__file__).with_name('collect-junkware-schedule-stream.py'))
stream = importlib.util.module_from_spec(spec); spec.loader.exec_module(stream)
fixture = {'appt_id': 'fixture-1', 'jk_type': 'JK123 Job 8', 'details': '', 'status': 'Scheduled', 'time': '08:00 AM - 10:00 AM', 'territory': 'New Orleans'}
collector = SimpleNamespace(normalize_appt=namespace['normalize_appt'], classify_territory=namespace['classify_territory'])
page_row = stream.appointment_rows(collector, {'appts': [fixture]}, 'New Orleans', 'https://example.invalid')[0]
full_row = namespace['normalize_appt'](fixture); full_row['market'] = 'New Orleans'
for field in ['appt_id', 'job_status', 'appointment_type', 'truck', 'appointment_time', 'driver', 'navigator', 'crew']:
    assert page_row[field] == full_row[field], field
assert page_row['driver'] == '' and page_row['crew'] == ''
full = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'collect_all_markets')
assert any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'normalize_appt' for node in ast.walk(full))
assert 'row["crew_assignment_status"]' in source and 'row["detail_collection_error"]' in source
assert 'row["appointment_time"] = ' not in source[source.index('def collect_attendance_source'):source.index('def collect_and_write_attendance')], 'detail must not overwrite schedule time'
refresh = (args.opsbot_root / 'scripts/run_opscenter_refresh.sh').read_text()
assert 'python3 scripts/collect_junkware_daily.py --date "$DATE"' in refresh
print(json.dumps({'pure_normalizer_sha256': hashlib.sha256(ast.get_source_segment(source, normalize).encode()).hexdigest(), 'collector_source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'same_schedule_page_fields': True, 'crew_placeholders_are_unknown': True, 'full_refresh_invokes_full_collector': True, 'upstream_revision_cursor_proven': False}, indent=2))
