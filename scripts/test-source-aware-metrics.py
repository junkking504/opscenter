#!/usr/bin/env python3
"""Mocked publication tests; optional --opsbot-root exercises installed shell source."""
import argparse
import csv
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from source_aware_metrics import SourcePublication, atomic_json

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install-source-aware-metrics.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
parser = argparse.ArgumentParser()
parser.add_argument('--opsbot-root', type=Path)
ARGS, REST = parser.parse_known_args()


def fixture(root, revenue='4262.98', now=None):
    now = now or datetime.now(timezone.utc)
    date = now.astimezone(__import__('zoneinfo').ZoneInfo('America/Chicago')).date().isoformat()
    base = root / 'data/history/junkware'
    base.mkdir(parents=True, exist_ok=True)
    row = {'job_id': 'TEST-JOB', 'revenue': revenue, 'job_status': 'Completed', 'appointment_type': 'Job'}
    raw = {'date': date, 'scraped_at': (now - timedelta(seconds=1)).isoformat(), 'completed': [row],
           'territory_verification': [{'territory_id': key, 'verified': True} for key in ['352', '477', '399', '484']]}
    atomic_json(base / f'junkware_{date}_raw.json', raw)
    for name in ['completed', 'live', 'employees']:
        with (base / f'junkware_{name}_{date}_summary.csv').open('w', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(row))
            writer.writeheader()
            writer.writerow(row)
    (base / f'junkware_truck_records_{date}.csv').write_text('truck,gas\n1,35\n')
    (base / f'junkware_employee_rates_{date}.csv').write_text('hourly_rate,collected_at\n20,' + raw['scraped_at'] + '\n')
    return date


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.date = fixture(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_gps_failure_keeps_fresh_revenue_and_old_gps_timestamp(self):
        old = datetime.now(timezone.utc) - timedelta(hours=5)
        linxup = self.root / 'data/history/linxup'
        atomic_json(linxup / f'linxup_{self.date}_raw.json', {'retrieved_at': old.isoformat()})
        (linxup / f'linxup_{self.date}_summary.csv').write_text('truck,miles\n1,42\n')
        atomic_json(self.root / 'data/health/collector_failures.json', {'conditions': [{'id': 'linxup'}]})
        metrics = SourcePublication(self.root, self.date).apply({'total_revenue': 4262.98})
        self.assertEqual(metrics['total_revenue'], 4262.98)
        self.assertEqual(metrics['source_freshness']['metrics']['revenue']['status'], 'current')
        gps = metrics['source_freshness']['sources']['linxup_summary']
        self.assertEqual(gps['status'], 'stale')
        self.assertEqual(gps['as_of'], old.isoformat())
        self.assertNotEqual(gps['as_of'], metrics['generated_at'])

    def test_failed_junkware_never_changes_existing_publication(self):
        target = self.root / 'published.json'
        atomic_json(target, {'total_revenue': 999})
        raw = self.root / f'data/history/junkware/junkware_{self.date}_raw.json'
        payload = json.loads(raw.read_text())
        payload['territory_verification'][0]['verified'] = False
        atomic_json(raw, payload)
        with self.assertRaisesRegex(ValueError, 'Unverified JunkWare'):
            atomic_json(target, SourcePublication(self.root, self.date).apply({'total_revenue': 0}))
        self.assertEqual(json.loads(target.read_text())['total_revenue'], 999)

    def test_missing_completed_and_mixed_capture_fail_closed(self):
        path = self.root / f'data/history/junkware/junkware_completed_{self.date}_summary.csv'
        original = path.read_text()
        path.write_text(original.replace('4262.98', '0'))
        with self.assertRaisesRegex(ValueError, 'does not match'):
            SourcePublication(self.root, self.date)
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            SourcePublication(self.root, self.date)

    def test_verified_empty_completed_is_zero(self):
        base = self.root / 'data/history/junkware'
        raw_path = base / f'junkware_{self.date}_raw.json'
        raw = json.loads(raw_path.read_text())
        raw['completed'] = []
        atomic_json(raw_path, raw)
        (base / f'junkware_completed_{self.date}_summary.csv').write_text('job_id,revenue,job_status,appointment_type\n')
        metrics = SourcePublication(self.root, self.date).apply({'total_revenue': 0})
        self.assertEqual(metrics['source_freshness']['metrics']['revenue']['status'], 'current')

    def test_old_costs_do_not_inherit_fresh_revenue_time(self):
        path = self.root / f'data/history/junkware/junkware_truck_records_{self.date}.csv'
        old = (datetime.now(timezone.utc) - timedelta(hours=3)).timestamp()
        os.utime(path, (old, old))
        metrics = SourcePublication(self.root, self.date).apply({'total_revenue': 4262.98})
        status = metrics['source_freshness']['metrics']
        self.assertEqual(status['revenue']['status'], 'current')
        self.assertEqual(status['operating_costs']['status'], 'stale')
        self.assertEqual(status['net']['status'], 'stale')
        self.assertEqual(status['operating_costs']['as_of'], datetime.fromtimestamp(old, timezone.utc).isoformat())

    def test_changed_input_or_wrong_total_prevents_write(self):
        publication = SourcePublication(self.root, self.date)
        with self.assertRaisesRegex(ValueError, 'differs'):
            publication.apply({'total_revenue': 0})
        path = self.root / f'data/history/junkware/junkware_employees_{self.date}_summary.csv'
        path.write_text(path.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, 'changed during'):
            publication.apply({'total_revenue': 4262.98})

    @unittest.skipUnless(ARGS.opsbot_root, 'Pass --opsbot-root to exercise live runner source with mocked collectors')
    def test_actual_runner_gps_and_junkware_failure_boundaries(self):
        scripts = self.root / 'scripts'
        scripts.mkdir()
        # Use the real orchestration, changing only paths and external commands.
        source = installer.patch_refresh((ARGS.opsbot_root / 'scripts/run_opscenter_refresh.sh').read_text())
        source = source.replace('WORKDIR="/Users/missioncontrol/.openclaw/workspace/opsbot"', f'WORKDIR="{self.root}"')
        source = source.replace('"$HOME/.openclaw/.env"', '"/nonexistent-test-env"')
        source = source.replace('LINXUP_LIVE_REFRESH="/Users/missioncontrol/opscenter-v2/opscenter/scripts/run-linxup-live-refresh.sh"', 'LINXUP_LIVE_REFRESH="/nonexistent-test-refresh"')
        runner = scripts / 'run_opscenter_refresh.sh'
        runner.write_text(source)
        # The hardening stub records the same durable failure contract and never
        # performs DNS or a provider request.
        (scripts / 'data-collection-hardening.sh').write_text('''run_hardened_source() {
  source_id="$1"; shift 2
  if [ "$source_id" = junkware ] && [ "${TEST_JUNKWARE_FAIL:-0}" = 1 ]; then return 1; fi
  if [ "$source_id" = linxup ] || [ "$source_id" = linxup_live ] || [ "$source_id" = linxup_alerts ]; then
    mkdir -p data/health
    echo '{"conditions":[{"id":"linxup"},{"id":"linxup_live"},{"id":"linxup_alerts"}]}' > data/health/collector_failures.json
    return 1
  fi
  "$@"
}
''')
        (scripts / 'collect_junkware_daily.py').write_text('''import os
from pathlib import Path
for p in Path('data/history/junkware').glob('*'):
    os.utime(p, None)
''')
        for name in ['collect_linxup_daily.py', 'collect_linxup_location_history.py', 'collect_linxup_alerts.py']:
            (scripts / name).write_text('raise RuntimeError("must be mocked")\n')
        (scripts / 'process_daily_metrics.py').write_text(f'''from pathlib import Path
from source_aware_metrics import SourcePublication, atomic_json
p = SourcePublication(Path.cwd(), {self.date!r})
atomic_json('data/history/daily_metrics/daily_metrics_{self.date}.json', p.apply({{"date":{self.date!r}, "total_revenue": 4262.98}}))
''')
        # Runner mtime validation expects each mock capture to replace old data.
        for p in (self.root / 'data/history/junkware').glob('*'):
            os.utime(p, (1, 1))
        env = dict(os.environ, OPSCENTER_DIR=str(self.root), PYTHONPATH=str(Path(__file__).parent))
        result = subprocess.run(['bash', str(runner), self.date], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        output = self.root / f'data/history/daily_metrics/daily_metrics_{self.date}.json'
        before = output.read_bytes()
        self.assertEqual(json.loads(before)['total_revenue'], 4262.98)
        self.assertEqual(json.loads(before)['source_freshness']['metrics']['revenue']['status'], 'current')
        result = subprocess.run(['bash', str(runner), self.date], env=dict(env, TEST_JUNKWARE_FAIL='1'), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(output.read_bytes(), before)

    @unittest.skipUnless(ARGS.opsbot_root, 'Pass --opsbot-root for isolated real processor validation')
    def test_real_processor_and_open_shift_cutoff(self):
        scripts = self.root / 'scripts'
        scripts.mkdir()
        for name in ['opsbot_paths.py', 'linxup_common.py', 'territory_classification.py']:
            shutil.copy2(ARGS.opsbot_root / 'scripts' / name, scripts / name)
        shutil.copy2(Path(__file__).with_name('source_aware_metrics.py'), scripts / 'source_aware_metrics.py')
        source = installer.patch_processor((ARGS.opsbot_root / 'scripts/process_daily_metrics.py').read_text())
        self.assertEqual(installer.patch_processor(source), source)
        (scripts / 'process_daily_metrics.py').write_text(source)
        # All provider access is disabled in this isolated synthetic run.
        (scripts / 'geocode.py').write_text('def geocode_appointments(rows):\n    return rows\n')
        atomic_json(self.root / 'data/config/linxup_vehicle_map.json', {'mappings': []})
        harness = scripts / 'exercise.py'
        harness.write_text(f'''import process_daily_metrics as p
from source_aware_metrics import timestamp
metrics, output = p.summarize({self.date!r})
assert metrics['total_revenue'] == 4262.98, metrics['total_revenue']
assert metrics['source_freshness']['metrics']['revenue']['status'] == 'current'
p.SNAPSHOT_EMPLOYEE_AS_OF = {self.date!r} + 'T10:00:00-05:00'
hours, basis = p.worked_hours('08:00 AM', '', '', {self.date!r})
assert hours == 2.0, hours
''')
        result = subprocess.run(['python3', str(harness)], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main(argv=[__file__] + REST)
