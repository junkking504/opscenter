import importlib.util
import subprocess
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("refresh", Path(__file__).with_name("refresh-linxup-geofence-alerts.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GeofenceRefreshTest(unittest.TestCase):
    def test_collects_requested_day_with_bounded_runtime(self):
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0)
        self.assertTrue(module.refresh("2026-09-08", Path("/synthetic/opsbot"), run))
        args, kwargs = calls[0]
        self.assertEqual(args[1:], ["/synthetic/opsbot/scripts/collect_linxup_alerts.py", "--date", "2026-09-08"])
        self.assertEqual(kwargs, {"cwd": Path("/synthetic/opsbot"), "timeout": 20, "check": False})

    def test_timeout_does_not_abort_position_runner(self):
        def run(*args, **kwargs):
            raise subprocess.TimeoutExpired("synthetic", 20)
        self.assertFalse(module.refresh("2026-09-08", Path("/synthetic"), run))

    def test_failure_does_not_abort_position_runner(self):
        self.assertFalse(module.refresh("2026-09-08", Path("/synthetic"), lambda *args, **kwargs: subprocess.CompletedProcess([], 1)))

    def test_invalid_date_never_calls_collector(self):
        def run(*args, **kwargs):
            self.fail("Invalid date reached collector")
        with self.assertRaises(ValueError):
            module.refresh("2026-09-99", Path("/synthetic"), run)


if __name__ == "__main__":
    unittest.main()
