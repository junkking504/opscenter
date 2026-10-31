"""Exercise the real installer readiness loop without services, network or delays."""
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path('deploy/macmini/install-junkware-schedule-detector.sh').read_text()
LOOP = SOURCE.split('# Cold initialization can exceed five minutes', 1)[1]
LOOP = LOOP[LOOP.index('for attempt in '):].split('# The all-market detector replaced', 1)[0]


class StartupWaitTests(unittest.TestCase):
    def run_wait(self, fresh_after=None, initial='1970-01-01T00:00:00+00:00'):
        with tempfile.TemporaryDirectory(prefix='detector-startup-') as directory:
            root = Path(directory)
            health = root / 'health.json'
            health.write_text('{"completed_at": "' + initial + '"}')
            polls = root / 'polls'
            script = '''set -Eeuo pipefail
HEALTH_FILE="$1"
POLL_FILE="$2"
FRESH_AFTER="$3"
INSTALL_STARTED_EPOCH=100
count=0
sleep() {
  count=$((count + 1))
  printf '%s' "$count" > "$POLL_FILE"
  if [ "$count" = "$FRESH_AFTER" ]; then
    printf '%s' '{"completed_at":"1970-01-01T00:01:41+00:00"}' > "$HEALTH_FILE"
  fi
}
''' + LOOP
            result = subprocess.run(['/bin/bash', '-c', script, 'test', str(health), str(polls), str(fresh_after)], capture_output=True, text=True, timeout=30)
            return result, int(polls.read_text()) if polls.exists() else 0

    def test_delayed_verified_heartbeat_can_finish_after_old_deadline(self):
        result, polls = self.run_wait(fresh_after=65)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(polls, 65)

    def test_old_heartbeat_still_fails_at_bounded_deadline(self):
        result, polls = self.run_wait()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('did not produce a fresh verified heartbeat', result.stderr)
        self.assertEqual(polls, 119)

    def test_new_heartbeat_returns_immediately(self):
        result, polls = self.run_wait(initial='1970-01-01T00:01:41+00:00')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(polls, 0)

    def test_malformed_heartbeat_never_passes(self):
        result, polls = self.run_wait(initial='invalid')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(polls, 119)


if __name__ == '__main__':
    unittest.main()
