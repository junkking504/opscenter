#!/usr/bin/env python3
"""No network, credentials, or runtime data: collector failure/recovery tests."""
import contextlib
import importlib.util
import io
import json
import ssl
import sys
import tempfile
import types
import unittest
import urllib.error
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

SOURCE = Path(__file__).resolve().parent / 'runtime/linxup'
sys.path.insert(0, str(SOURCE))
spec = importlib.util.spec_from_file_location('installer', SOURCE.parents[1] / 'install-linxup-collection-safety.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
collector_sources = tempfile.TemporaryDirectory()
for name in json.loads((SOURCE / 'baseline-sha256.json').read_text()):
    original = (SOURCE.parents[1] / 'fixtures/linxup' / name).read_bytes()
    (Path(collector_sources.name) / name).write_bytes(installer.patched_source(name, original))
sys.path.insert(0, collector_sources.name)
common = types.ModuleType('linxup_common')
class LinxupError(RuntimeError):
    pass
common.LinxupError = LinxupError
common.LINXUP_HISTORY = Path('/test-only')
common.keychain_secret = lambda _: 'test-token'
common.iso_utc = lambda t: t.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
common.collected_at = lambda: common.iso_utc(datetime.now(timezone.utc))
common.epoch_ms = lambda t: int(t.timestamp() * 1000)
common.parse_timestamp = lambda s: datetime.fromisoformat(str(s).replace('Z', '+00:00')) if s else None
common.tracker_log_alias = lambda _: 'test-tracker'
common.mappings_for_date = lambda _: [types.SimpleNamespace(linxup_tracker_id='test', junkware_truck_number='Truck 1', linxup_vehicle_name='Test')]
def date_bounds(target, include_next_day_hours=0):
    start = datetime.combine(target, time.min, ZoneInfo('America/Chicago'))
    return start, start + timedelta(days=1, hours=include_next_day_hours)
common.date_bounds = date_bounds
def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
common.write_json = write_json
sys.modules['linxup_common'] = common
paths = types.ModuleType('opsbot_paths')
paths.ensure_history_dirs = lambda: None
paths.relpath = str
for name in ('linxup_raw_path', 'linxup_summary_path', 'linxup_alerts_path', 'linxup_alerts_raw_path', 'linxup_alerts_csv_path', 'linxup_alerts_status_path'):
    setattr(paths, name, lambda _: Path('/test-only'))
sys.modules['opsbot_paths'] = paths
import linxup_collection_safety as safety
import collect_linxup_daily as daily
import collect_linxup_alerts as alerts
import collect_linxup_location_history as history

class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(sys, 'argv', ['collector', '--date', '2026-09-15']))
        self.stack.enter_context(patch.dict('os.environ', {'LINXUP_API_KEY': 'test-token'}))
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        mapping = {
            'linxup_raw_path': 'linxup_2026-09-15_raw.json',
            'linxup_summary_path': 'linxup_2026-09-15_summary.csv',
            'linxup_alerts_path': 'alerts/linxup_alerts_2026-09-15.json',
            'linxup_alerts_raw_path': 'alerts/raw/linxup_alerts_2026-09-15.json',
            'linxup_alerts_csv_path': 'alerts/linxup_alerts_2026-09-15.csv',
            'linxup_alerts_status_path': 'alerts/linxup_alerts_2026-09-15_status.json',
        }
        for key, name in mapping.items():
            fn = lambda _, name=name: self.root / name
            for module in (paths, daily, alerts):
                if hasattr(module, key):
                    self.stack.enter_context(patch.object(module, key, fn))
        self.stack.enter_context(patch.object(history, 'LINXUP_HISTORY', self.root))
        self.stack.enter_context(patch.object(history, 'normalized_v3_push_points', return_value=[]))

    def expiry(self, code=10):
        error = ssl.SSLCertVerificationError(1, 'test certificate error')
        error.verify_code = code
        return urllib.error.URLError(error)

    def test_certificate_failure_is_verified_and_not_retried(self):
        for code in (10, 62, 20):
            with self.subTest(code=code), patch.object(safety.urllib.request, 'urlopen', side_effect=self.expiry(code)) as request, patch.object(safety.time, 'sleep') as sleep:
                with self.assertRaisesRegex(LinxupError, 'TLS verification failed'):
                    safety.request_json('https://www.awaregps.com/test', 'secret')
                self.assertEqual(request.call_count, 1)
                context = request.call_args.kwargs['context']
                self.assertTrue(context.check_hostname)
                self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
                sleep.assert_not_called()

    def test_transient_failures_bounded_and_daily_not_expanded(self):
        with patch.object(safety.urllib.request, 'urlopen', side_effect=urllib.error.URLError(TimeoutError())), patch.object(safety.time, 'sleep') as sleep:
            with self.assertRaises(LinxupError):
                safety.request_json('https://www.awaregps.com/test', 'secret')
            self.assertEqual(sleep.call_count, 4)
            sleep.reset_mock()
            with self.assertRaises(LinxupError):
                daily.request_json('https://www.awaregps.com/test', 'secret')
            sleep.assert_not_called()

    def test_invalid_envelope_is_not_empty_success(self):
        for value in (None, {}, {'data': None}, {'error': 'bad'}, {'success': False, 'data': []}, {'data': [3]}):
            with self.subTest(value=value), self.assertRaises(LinxupError):
                safety.validate_response(value)
        self.assertEqual(safety.validate_response({'data': {'alerts': []}}), {'data': {'alerts': []}})

    def test_all_collectors_preserve_data_and_timestamp_on_tls_failure(self):
        for name, module in [('daily', daily), ('alerts', alerts), ('location_history', history)]:
            snapshot, status = safety.source_paths(name, '2026-09-15')
            old = {'collection_timestamp': '2026-09-15T13:16:00Z', 'data': ['retained']}
            write_json(snapshot, old)
            before = snapshot.read_bytes()
            before_mtime = snapshot.stat().st_mtime_ns
            csv_path = self.root / 'linxup_2026-09-15_summary.csv'
            csv_path.write_text('retained GPS\n')
            with patch.object(safety.urllib.request, 'urlopen', side_effect=self.expiry()):
                self.assertEqual(safety.run_collector(name, module.main), 1)
            self.assertEqual(snapshot.read_bytes(), before)
            self.assertEqual(snapshot.stat().st_mtime_ns, before_mtime)
            self.assertEqual(csv_path.read_text(), 'retained GPS\n')
            result = json.loads(status.read_text())
            self.assertEqual(result['source_status'], 'failed')
            self.assertEqual(result['status'], 'stale')
            self.assertEqual(result['collection_timestamp'], old['collection_timestamp'])
            self.assertIn('certificate expired', result['collection_error'])

    def test_no_snapshot_failure_reports_missing(self):
        with patch.object(daily, 'request_json', side_effect=LinxupError('offline')):
            self.assertEqual(safety.run_collector('daily', daily.main), 1)
        snapshot, status = safety.source_paths('daily', '2026-09-15')
        self.assertFalse(snapshot.exists())
        self.assertEqual(json.loads(status.read_text())['status'], 'missing')

    def test_partial_daily_failure_retains_raw_and_summary(self):
        snapshot, _ = safety.source_paths('daily', '2026-09-15')
        write_json(snapshot, {'retrieved_at': '2026-09-15T13:16:00Z'})
        old = snapshot.read_bytes()
        with patch.object(daily, 'request_json', side_effect=[{'data': []}, LinxupError('HTTP 503'), {'data': []}, {'data': []}]):
            self.assertEqual(safety.run_collector('daily', daily.main), 1)
        self.assertEqual(snapshot.read_bytes(), old)
        self.assertFalse((self.root / 'linxup_2026-09-15_summary.csv').exists())

    def test_success_clears_failure_status_for_each_collector(self):
        for name, module in [('daily', daily), ('alerts', alerts), ('location_history', history)]:
            _, status = safety.source_paths(name, '2026-09-15')
            write_json(status, {'source_status': 'failed', 'collection_error': 'old failure'})
            with patch.object(module, 'request_json', return_value={'data': []}):
                self.assertEqual(safety.run_collector(name, module.main), 0)
            result = json.loads(status.read_text())
            self.assertEqual(result['status'], 'current')
            self.assertEqual(result['source_status'], 'success')
            self.assertEqual(result['collection_error'], '')
            self.assertIsNotNone(result['last_success_at'])

    def test_empty_alert_regression_is_stale_and_nonzero(self):
        snapshot, status = safety.source_paths('alerts', '2026-09-15')
        write_json(snapshot, {'record_count': 1, 'alerts': [{}], 'collection_timestamp': '2026-09-15T13:16:00Z'})
        old = snapshot.read_bytes()
        with patch.object(alerts, 'request_json', return_value={'data': []}):
            self.assertEqual(safety.run_collector('alerts', alerts.main), 1)
        self.assertEqual(snapshot.read_bytes(), old)
        self.assertEqual(json.loads(status.read_text())['status'], 'stale')

    def test_old_error_snapshot_is_not_claimed_as_last_success(self):
        snapshot, status = safety.source_paths('daily', '2026-09-15')
        write_json(snapshot, {'retrieved_at': '2026-09-15T18:10:00Z', 'responses': {'locations': {'error': 'URLError'}}})
        with patch.object(daily, 'request_json', side_effect=LinxupError('offline')):
            self.assertEqual(safety.run_collector('daily', daily.main), 1)
        result = json.loads(status.read_text())
        self.assertEqual(result['status'], 'missing')
        self.assertIsNone(result['last_success_at'])

    def test_malformed_json_is_failed_without_retry(self):
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'not-json'
        with patch.object(safety.urllib.request, 'urlopen', return_value=response) as request:
            with self.assertRaisesRegex(LinxupError, 'invalid JSON'):
                safety.request_json('https://www.awaregps.com/test', 'secret')
            self.assertEqual(request.call_count, 1)

    def test_installer_applies_reviewed_patch_and_backs_up_originals(self):
        runtime = self.root / 'scripts'
        runtime.mkdir()
        originals = {}
        for name in json.loads((SOURCE / 'baseline-sha256.json').read_text()):
            originals[name] = (SOURCE.parents[1] / 'fixtures/linxup' / name).read_bytes()
            (runtime / name).write_bytes(originals[name])
        installer.install(self.root, True)
        backups = list((self.root / 'backups').iterdir())
        self.assertEqual(len(backups), 1)
        for name, old in originals.items():
            self.assertEqual((backups[0] / name).read_bytes(), old)
            self.assertEqual((runtime / name).read_bytes(), (Path(collector_sources.name) / name).read_bytes())
        installer.install(self.root, True)
        self.assertEqual(len(list((self.root / 'backups').iterdir())), 1)

    def test_installer_rejects_drift_before_any_write_and_is_idempotent(self):
        spec = importlib.util.spec_from_file_location('installer', SOURCE.parents[1] / 'install-linxup-collection-safety.py')
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        runtime = self.root / 'scripts'
        runtime.mkdir()
        for name in json.loads((SOURCE / 'baseline-sha256.json').read_text()):
            (runtime / name).write_text('unreviewed drift')
        with self.assertRaisesRegex(RuntimeError, 'Unreviewed runtime drift'):
            installer.install(self.root, True)
        self.assertFalse((runtime / 'linxup_collection_safety.py').exists())
        for name in ('linxup_collection_safety.py', *json.loads((SOURCE / 'baseline-sha256.json').read_text())):
            path = SOURCE / name if name == 'linxup_collection_safety.py' else Path(collector_sources.name) / name
            (runtime / name).write_bytes(path.read_bytes())
        installer.install(self.root, True)
        self.assertFalse((self.root / 'backups').exists())

if __name__ == '__main__':
    unittest.main()
