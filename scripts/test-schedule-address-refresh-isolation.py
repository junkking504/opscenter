"""Fault-inject GPS failures into the real runner; never contact providers."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

RUNNER = Path(__file__).with_name('run-linxup-live-refresh.sh')


class AddressSweepIsolation(unittest.TestCase):
    def test_gps_failure_cannot_skip_address_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commands = root / 'commands'
            commands.mkdir()
            node = commands / 'node'
            node.write_text('''#!/bin/bash
echo "$*" >> "$TASK_CALL_LOG"
case "$*" in
  *refresh-schedule-map-inputs.ts*) exit "${TASK_ADDRESS_EXIT:-0}" ;;
  *drain-linxup-push.ts*) exit 17 ;;
esac
exit 99
''')
            node.chmod(0o755)
            probe = commands / 'scutil'
            probe.write_text('#!/bin/bash\nexit 1\n')
            probe.chmod(0o755)
            runner = root / 'runner.sh'
            # Replace only the OS connectivity executable with a local stub.
            runner.write_text(RUNNER.read_text().replace('/usr/sbin/scutil', str(probe)))
            log = root / 'calls'
            env = dict(os.environ, PATH=f'{commands}:{os.environ["PATH"]}',
                       OPSBOT_DIR=str(root), OPSCENTER_DIR=str(root),
                       OPSCENTER_LINXUP_LOCK_FD='1', TASK_CALL_LOG=str(log))
            for address_exit in ['0', '1']:
                log.write_text('')
                result = subprocess.run(['/bin/bash', str(runner), '2026-09-15'],
                                        env=dict(env, TASK_ADDRESS_EXIT=address_exit),
                                        capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 0)
                self.assertIn("GPS push drain pending", result.stderr)
                calls = log.read_text().splitlines()
                self.assertEqual(calls, [
                    '--import tsx scripts/drain-linxup-push.ts',
                    '--import tsx scripts/refresh-schedule-map-inputs.ts 2026-09-15',
                ])
                if address_exit == '1':
                    self.assertIn('retaining previous verified data', result.stderr)


if __name__ == '__main__':
    unittest.main()
