#!/usr/bin/python3
"""Synthetic process lifecycle tests; no network, credentials or business writes."""
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

module_path = Path(__file__).with_name('run-opsbot-refresh-locked.py').resolve()
spec = importlib.util.spec_from_file_location('refresh_lock', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.lock = self.root / 'lock'

    def tearDown(self):
        self.tmp.cleanup()

    def run_job(self, code='pass', **kwargs):
        return module.run_locked(self.lock, [sys.executable, '-c', code], os.environ, **kwargs)

    def test_reuse_and_stable_inode(self):
        self.assertEqual(self.run_job(), 0)
        inode = self.lock.with_name(self.lock.name + '.worker').stat().st_ino
        self.assertEqual(self.run_job(), 0)
        self.assertEqual(self.lock.with_name(self.lock.name + '.worker').stat().st_ino, inode)

    def test_legacy_owner_is_not_stolen(self):
        self.lock.mkdir()
        self.assertEqual(self.run_job(), 75)
        self.assertEqual(list(self.lock.iterdir()), [])

    def test_timeout_releases(self):
        self.assertEqual(self.run_job('import time; time.sleep(20)', timeout=0.1), 124)
        self.assertEqual(self.run_job(), 0)

    def test_legacy_mkdir_caller_is_excluded_and_can_run_afterward(self):
        code = 'import os; from pathlib import Path; p=Path(%r); assert p.is_dir(); assert p.is_symlink()' % str(self.lock)
        self.assertEqual(self.run_job(code), 0)
        self.assertFalse(self.lock.exists())
        self.lock.mkdir()
        self.assertEqual(self.run_job(), 75)
        self.lock.rmdir()
        self.assertEqual(self.run_job(), 0)

    def test_failed_launch_does_not_leave_marker(self):
        with self.assertRaises(FileNotFoundError):
            module.run_locked(self.lock, ['/nonexistent-test-program'], os.environ)
        self.assertFalse(self.lock.exists())
        self.assertEqual(self.run_job(), 0)

    def test_launcher_crash_retains_live_child_lock(self):
        pidfile = self.root / 'child.pid'
        childcode = 'import os,time; from pathlib import Path; Path(%r).write_text(str(os.getpid())); time.sleep(1.5)' % str(pidfile)
        code = ('import importlib.util,os; s=importlib.util.spec_from_file_location("lock",%r); '
                'm=importlib.util.module_from_spec(s); s.loader.exec_module(m); '
                'm.run_locked(%r,%r,os.environ)') % (str(module_path), str(self.lock), [sys.executable, '-c', childcode])
        launcher = subprocess.Popen([sys.executable, '-c', code])
        child = None
        try:
            for _ in range(100):
                if pidfile.exists():
                    break
                time.sleep(0.02)
            self.assertTrue(pidfile.exists())
            child = int(pidfile.read_text())
            self.assertEqual(self.run_job(), 75)
            launcher.kill()
            launcher.wait()
            self.assertEqual(self.run_job(), 75, 'A live child must still exclude concurrent writers')
            time.sleep(1.6)
            self.assertEqual(self.run_job(), 0, 'Crash cannot leave a permanent filesystem lock')
        finally:
            if launcher.poll() is None:
                launcher.kill()
                launcher.wait()
            if child:
                try:
                    os.kill(child, signal.SIGKILL)
                except ProcessLookupError:
                    pass


unittest.main()
