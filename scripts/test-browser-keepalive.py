"""Exercise gateway recovery with fake commands; never touch a real service."""
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = (Path(__file__).resolve().parents[1] / 'deploy/macmini/runtime/browser_keepalive.sh').read_text()
FUNCTION = SOURCE.split('ensure_gateway() {', 1)[1].split('\nensure_junkware_collector_session()', 1)[0]
FUNCTION = 'ensure_gateway() {' + FUNCTION

class KeepaliveTest(unittest.TestCase):
    def run_gateway(self, healthy, registered):
        with tempfile.TemporaryDirectory() as directory:
            trace = Path(directory) / 'calls'
            plist = Path(directory) / 'gateway.plist'
            plist.touch()
            script = '''
OPENCLAW=mock-openclaw
run_cmd() {
  print -r -- "$*" >> "$TRACE"
  if [[ "$1" == mock-openclaw ]]; then return "$HEALTH_RC"; fi
  if [[ "$2" == bootstrap ]]; then return 0; fi
  return "$START_RC"
}
''' + FUNCTION + '\nensure_gateway\n'
            result = subprocess.run(['zsh', '-c', script], env={
                'PATH': '/usr/bin:/bin', 'TRACE': str(trace),
                'GATEWAY_PLIST': str(plist),
                'HEALTH_RC': '0' if healthy else '1',
                'START_RC': '0' if registered else '1',
            }, capture_output=True, text=True)
            return result.returncode, trace.read_text().splitlines()

    def test_healthy_gateway_is_not_restarted(self):
        rc, calls = self.run_gateway(True, True)
        self.assertEqual(rc, 0)
        self.assertEqual(calls, ['mock-openclaw gateway status --require-rpc --timeout 5000'])

    def test_offline_gateway_start_does_not_kill_processes(self):
        rc, calls = self.run_gateway(False, True)
        self.assertEqual(rc, 0)
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[1].startswith('launchctl kickstart gui/'))
        self.assertNotIn(' -k ', '\n'.join(calls))

    def test_failed_recovery_reports_failure_without_force_restart(self):
        rc, calls = self.run_gateway(False, False)
        self.assertNotEqual(rc, 0)
        self.assertTrue(any(' bootstrap ' in call for call in calls))
        self.assertNotIn(' -k ', '\n'.join(calls))

    def test_navigation_is_pinned_to_owned_tab(self):
        calls = [line.strip() for line in SOURCE.splitlines() if 'run_browser navigate ' in line]
        self.assertEqual(len(calls), 2)
        self.assertTrue(all('--target-id "$JUNK_TAB_ID"' in call for call in calls))

if __name__ == '__main__':
    unittest.main()
