import contextlib
import pathlib
import tempfile
import unittest
import errno
import os
from unittest.mock import patch
from types import SimpleNamespace
from opscenter_process_recovery import tick, atomic_json, read_state, Runtime


class FakeRuntime:
    kind = 'stopped'
    busy = False
    guarded = True
    success = True
    healthy_result = True
    change = False
    starts = 0
    crash = False

    def inspect(self):
        return self.kind, 'Blocked by write lock'

    def healthy(self):
        return self.healthy_result

    def deployment_active(self):
        return self.busy

    @contextlib.contextmanager
    def deployment_guard(self):
        if self.change:
            self.kind = 'running'
        yield self.guarded

    def release(self):
        return 'fixed-release'

    def start(self):
        self.starts += 1
        if self.crash:
            raise RuntimeError('Simulated worker crash')
        return self.success

    def verify(self):
        return self.healthy_result


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        environment = patch.dict(os.environ, {'OPSBOT_DATA_DIR': str(self.directory)})
        environment.start(); self.addCleanup(environment.stop)
        self.runtime = FakeRuntime()
        self.now = 1788890400
        atomic_json(self.directory / 'recovery-policy.json', {'version': 1, 'enabled': True})

    def tick(self, advance=60):
        self.now += advance
        return tick(self.directory, self.runtime, self.now)

    def outage(self):
        self.tick(); self.tick(); return self.tick()

    def test_confirmation_and_single_attempt(self):
        self.tick(); self.tick(10); self.tick(50)
        self.assertEqual(self.runtime.starts, 0)
        self.assertIn('verified', self.tick()['status'])
        self.tick(); self.tick(2000)
        self.assertEqual(self.runtime.starts, 1)

    def test_pause_survives_and_does_not_reset_attempt(self):
        self.outage()
        atomic_json(self.directory / 'recovery-policy.json', {'version': 1, 'enabled': False})
        self.assertIn('Paused', self.tick()['status'])
        atomic_json(self.directory / 'recovery-policy.json', {'version': 1, 'enabled': True})
        self.outage()
        self.assertEqual(self.runtime.starts, 1)

    def test_missing_or_corrupt_policy(self):
        (self.directory / 'recovery-policy.json').write_text('broken')
        self.assertIn('Paused', self.outage()['status'])
        self.assertEqual(self.runtime.starts, 0)

    def test_running_unhealthy_never_restarted(self):
        self.runtime.kind = 'running'; self.runtime.healthy_result = False
        self.assertIn('prohibited', self.outage()['status'])
        self.assertEqual(self.runtime.starts, 0)

    def test_write_lock_and_unknown_evidence_block(self):
        self.runtime.kind = 'blocked'; self.outage()
        self.assertEqual(self.runtime.starts, 0)

    def test_deployment_and_race_block(self):
        self.runtime.busy = True; self.outage()
        self.runtime.busy = False; self.runtime.guarded = False; self.outage()
        self.assertEqual(self.runtime.starts, 0)
        self.runtime.guarded = True; self.runtime.change = True; self.tick()
        self.assertEqual(self.runtime.starts, 0)

    def test_long_gap_requires_new_confirmation(self):
        self.tick(); self.tick(); self.tick(151)
        self.assertEqual(self.runtime.starts, 0)

    def test_failure_and_crash_consume_attempt(self):
        self.runtime.healthy_result = False
        self.assertIn('unverified', self.outage()['status'])
        self.assertTrue(read_state(self.directory)['attempted'])
        self.tick(); self.assertEqual(self.runtime.starts, 1)

    def test_crash_reservation_persists(self):
        self.tick(); self.tick(); self.runtime.crash = True
        with self.assertRaises(RuntimeError): self.tick()
        self.runtime.crash = False
        self.assertIn('already used', self.tick()['status'])
        self.assertEqual(self.runtime.starts, 1)

    def test_cooldown_and_daily_limit(self):
        self.outage()
        self.runtime.kind = 'running'; self.outage()
        self.runtime.kind = 'stopped'
        self.assertIn('cooldown', self.outage()['status'])
        self.tick(1800); self.outage()
        self.assertEqual(self.runtime.starts, 2)
        self.runtime.kind = 'running'; self.outage()
        self.runtime.kind = 'stopped'; self.tick(1800)
        self.assertIn('Daily limit', self.outage()['status'])
        self.assertEqual(self.runtime.starts, 2)

    def test_corrupt_and_lost_ledger_fail_closed(self):
        self.outage()
        (self.directory / 'recovery.json').write_text('{}')
        with self.assertRaises((KeyError, AssertionError)): self.tick()
        (self.directory / 'recovery.json').unlink()
        with self.assertRaises(ValueError): self.tick()
        self.assertEqual(self.runtime.starts, 1)

    def test_actual_command_is_start_only_fixed_service(self):
        runtime = Runtime()
        with patch.object(runtime, 'command', return_value=SimpleNamespace(returncode=0)) as command:
            self.assertTrue(runtime.start())
            self.assertEqual(command.call_args.args[0], ['/bin/launchctl', 'kickstart', runtime.target])

    def test_actual_service_parser_blocks_disabled_and_unloaded(self):
        runtime = Runtime()
        with patch.object(runtime, 'command', return_value=SimpleNamespace(returncode=1, stdout='')):
            self.assertEqual(runtime.inspect()[0], 'blocked')
        stopped = SimpleNamespace(returncode=0, stdout='state = not running\n' + str(runtime.app / 'scripts/run_opscenter.sh'))
        for disabled in ('disabled', 'true', 'unknown'):
            with patch.object(runtime, 'command', side_effect=[stopped, SimpleNamespace(returncode=0, stdout='"com.openclaw.opscenter" => ' + disabled)]):
                self.assertEqual(runtime.inspect()[0], 'blocked')

    def test_actual_stopped_service_and_occupied_port(self):
        runtime = Runtime(); runtime.app = self.directory
        stopped = SimpleNamespace(returncode=0, stdout='state = not running\n' + str(runtime.app / 'scripts/run_opscenter.sh'))
        enabled = SimpleNamespace(returncode=0, stdout='"com.openclaw.opscenter" => enabled')
        processes = SimpleNamespace(returncode=0, stdout='safe unrelated process')
        with patch.object(runtime, 'command', side_effect=[stopped, enabled, processes]), patch('socket.create_connection', side_effect=OSError(errno.ECONNREFUSED, 'closed')), patch('pathlib.Path.exists', return_value=False):
            self.assertEqual(runtime.inspect()[0], 'stopped')
        with patch.object(runtime, 'command', side_effect=[stopped, enabled]), patch('socket.create_connection'):
            self.assertEqual(runtime.inspect()[0], 'blocked')
        with patch.object(runtime, 'command', side_effect=[stopped, enabled]), patch('socket.create_connection', side_effect=TimeoutError('unknown')):
            self.assertEqual(runtime.inspect()[0], 'blocked')

    def test_verification_requires_three_consecutive_successes(self):
        runtime = Runtime()
        with patch('time.sleep'), patch.object(runtime, 'healthy', side_effect=[False, False, True, True, True]):
            self.assertTrue(runtime.verify())
        with patch('time.sleep'), patch.object(runtime, 'healthy', side_effect=[True, True, False, True, True]):
            self.assertFalse(runtime.verify())

    def test_pause_under_deployment_guard_blocks_command(self):
        @contextlib.contextmanager
        def guard():
            atomic_json(self.directory / 'recovery-policy.json', {'version': 1, 'enabled': False})
            yield True
        self.runtime.deployment_guard = guard
        self.outage()
        self.assertEqual(self.runtime.starts, 0)

    def test_actual_deployment_lock_does_not_remove_other_owner(self):
        runtime = Runtime(); runtime.root = self.directory
        lock = self.directory / '.deploy-lock'; lock.mkdir(); (lock / 'owner').write_text('another deployment')
        with runtime.deployment_guard() as acquired: self.assertFalse(acquired)
        self.assertEqual((lock / 'owner').read_text(), 'another deployment')
        (lock / 'owner').unlink(); lock.rmdir()
        with runtime.deployment_guard() as acquired:
            self.assertTrue(acquired); self.assertTrue(lock.exists())
        self.assertFalse(lock.exists())


if __name__ == '__main__':
    unittest.main()
