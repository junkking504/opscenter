import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('installer',Path(__file__).resolve().parents[1]/'deploy/macmini/install-postgres-log-rotation.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.home=Path(self.temp.name).resolve()
        self.control=self.home/'Library/Application Support/OpsCenter/log-control'
        self.logs=self.home/'Library/Logs/OpsCenter'
        self.control.mkdir(parents=True);self.logs.mkdir(parents=True)
        self.outside=self.home/'outside';self.outside.mkdir()
    def tearDown(self):self.temp.cleanup()
    def test_valid_plan_does_not_write(self):
        m.validate_destinations(self.home,'test')
        self.assertFalse((self.control/'install-backups').exists())
    def test_backup_symlink_rejected(self):
        (self.control/'install-backups').symlink_to(self.outside,target_is_directory=True)
        with self.assertRaises(RuntimeError):m.validate_destinations(self.home,'test')
        self.assertEqual(list(self.outside.iterdir()),[])
    def test_log_symlink_rejected(self):
        (self.logs/'postgres-log-rotation.err.log').symlink_to(self.outside/'sensitive')
        with self.assertRaises(RuntimeError):m.validate_destinations(self.home,'test')
    def test_hardlinked_log_rejected(self):
        p=self.outside/'sensitive';p.write_text('keep')
        os.link(p,self.logs/'postgres-log-rotation.log')
        with self.assertRaises(RuntimeError):m.validate_destinations(self.home,'test')
        self.assertEqual(p.read_text(),'keep')
    def test_writable_diagnostic_rejected(self):
        p=self.logs/'postgres-log-rotation.log';p.write_text('');p.chmod(0o666)
        with self.assertRaises(RuntimeError):m.validate_destinations(self.home,'test')
if __name__=='__main__':unittest.main()
