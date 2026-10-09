#!/usr/bin/env python3
import fcntl
import gzip
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
spec = importlib.util.spec_from_file_location('rotation', Path(__file__).with_name('rotate-postgres-log.py'))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)

class RotationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.directory = Path(self.temp.name).resolve()
        self.log = self.directory / r.LOG; self.log.write_bytes(b'warning\n' * 100)
        self.inode = self.log.stat().st_ino
    def tearDown(self): self.temp.cleanup()
    def run_rotation(self, apply=True): return r.rotate(self.directory, apply, threshold=32)
    def test_dry_run_and_threshold(self):
        before = self.log.read_bytes()
        self.assertEqual(self.run_rotation(False)['status'], 'would_rotate')
        self.assertEqual(before, self.log.read_bytes())
        self.assertEqual(r.rotate(self.directory, True)['status'], 'below_threshold')
    def test_preserves_writer_and_three_archives_only(self):
        unrelated = self.directory/'records.json'; unrelated.write_text('keep')
        with self.log.open('ab', buffering=0) as writer:
            for i in range(5):
                content=(str(i)*80).encode(); self.log.write_bytes(content)
                self.assertEqual(self.run_rotation()['status'], 'rotated')
                self.assertEqual(gzip.decompress((self.directory/(r.LOG+'.1.gz')).read_bytes()),content)
                self.assertEqual(self.log.stat().st_ino,self.inode)
            writer.write(b'new warning')
        self.assertEqual(self.log.read_bytes(),b'new warning')
        self.assertEqual(len(list(self.directory.glob('*.gz'))),3)
        self.assertEqual(gzip.decompress((self.directory/(r.LOG+'.3.gz')).read_bytes()),b'2'*80)
        self.assertEqual(unrelated.read_text(),'keep')
    def test_symlinks_and_hardlinks_fail_closed(self):
        outside=self.directory/'outside'; outside.write_text('protected')
        self.log.unlink();self.log.symlink_to(outside)
        with self.assertRaises(RuntimeError): self.run_rotation()
        self.log.unlink();os.link(outside,self.log)
        with self.assertRaises(RuntimeError):self.run_rotation()
        self.assertEqual(outside.read_text(),'protected')
    def test_archive_symlink_does_not_change_log(self):
        target=self.directory/'outside';target.write_text('protected')
        (self.directory/(r.LOG+'.2.gz')).symlink_to(target)
        with self.assertRaises(RuntimeError):self.run_rotation()
        self.assertGreater(self.log.stat().st_size,32);self.assertEqual(target.read_text(),'protected')
    def test_parent_symlink_denied(self):
        alias=self.directory/'alias';alias.symlink_to(self.directory,target_is_directory=True)
        with self.assertRaises(OSError):r.rotate(alias,True,32)
    def test_lock_serializes(self):
        with (self.directory/'.postgres-log-rotation.lock').open('w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.assertEqual(self.run_rotation()['status'],'busy')
        self.assertGreater(self.log.stat().st_size,32)
    def test_compression_failure_preserves_live_log_and_blocks_next_run(self):
        before=self.log.read_bytes()
        with mock.patch.object(r.gzip.GzipFile,'write',side_effect=OSError('fixture disk full')):
            with self.assertRaises(OSError):self.run_rotation()
        self.assertEqual(self.log.read_bytes(),before)
        self.assertEqual(json.loads((self.directory/'postgres-log-rotation-status.json').read_text())['status'],'failed')
        with self.assertRaises(RuntimeError):self.run_rotation()
    def test_truncate_failure_preserves_archive_and_live_log(self):
        before=self.log.read_bytes()
        with mock.patch.object(r.os,'ftruncate',side_effect=OSError('fixture truncate denied')):
            with self.assertRaises(OSError):self.run_rotation()
        self.assertEqual(self.log.read_bytes(),before)
        self.assertEqual(gzip.decompress((self.directory/(r.LOG+'.rotation-pending.gz')).read_bytes()),before)
    def test_abandoned_receipt_temp_does_not_block(self):
        (self.directory/'.postgres-log-rotation-status.999999.tmp').write_text('partial')
        self.assertEqual(self.run_rotation()['status'], 'rotated')
    def test_replaced_log_preserved_and_next_run_recovers(self):
        before=self.log.read_bytes();read=r.os.read;replaced=False
        def replace(fd,count):
            nonlocal replaced
            value=read(fd,count)
            if not replaced:
                replaced=True
                self.log.rename(self.directory/'original.log')
                self.log.write_bytes(b'replacement warning'*10)
            return value
        with mock.patch.object(r.os,'read',side_effect=replace):
            result=self.run_rotation()
        self.assertEqual(result['status'],'retry');self.assertEqual(result['reason'],'log_replaced')
        self.assertEqual((self.directory/'original.log').read_bytes(),before)
        self.assertEqual(self.log.read_bytes(),b'replacement warning'*10)
        self.assertFalse((self.directory/(r.LOG+'.rotation-pending.gz')).exists())
        self.assertEqual(self.run_rotation()['status'],'rotated')
    def test_growing_log_preserved(self):
        read=r.os.read;grew=False
        def append(fd,count):
            nonlocal grew
            value=read(fd,count)
            if not grew:
                grew=True
                with self.log.open('ab') as f:f.write(b'concurrent warning')
            return value
        with mock.patch.object(r.os,'read',side_effect=append):
            self.assertEqual(self.run_rotation()['status'], 'retry')
        self.assertFalse((self.directory/(r.LOG+'.rotation-pending.gz')).exists())
        self.assertTrue(self.log.read_bytes().endswith(b'concurrent warning'))
        self.assertEqual(self.run_rotation()['status'], 'rotated')

if __name__=='__main__':unittest.main()
