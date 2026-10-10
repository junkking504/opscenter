import importlib.util
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

source=Path(__file__).resolve().parents[1]/'deploy/macmini/install-controller-bundle.py'
spec=importlib.util.spec_from_file_location('bundle',source);b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve();self.repo=self.root/'repo';self.repo.mkdir();self.control=self.root/'control';self.control.mkdir(mode=0o700)
        self.git('init','-q');self.git('config','user.email','fixture@example.invalid');self.git('config','user.name','Fixture')
        for name in b.FILES:
            file=self.repo/'deploy/macmini'/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('reviewed fixture '+name+'\n')
        for name in b.CORE:(self.control/name).write_text('legacy '+name+'\n')
        (self.control/'spending-allowlist.json').write_text('do not change')
        self.sha=self.commit()
    def tearDown(self):self.temp.cleanup()
    def git(self,*args):return subprocess.check_output(['git','-C',str(self.repo),*args],stderr=subprocess.DEVNULL).decode().strip()
    def commit(self):self.git('add','.');self.git('commit','-qm','fixture');return self.git('rev-parse','HEAD')
    def test_complete_bundle_preserves_exact_baseline_and_spending(self):
        result=b.install(self.repo,self.control,self.sha,False)
        for name in b.CORE:
            self.assertEqual((self.control/'controller-previous'/name).read_text(),'legacy '+name+'\n')
        for name in b.CORE+b.EXTRA:
            self.assertEqual((self.control/name).read_text(),'reviewed fixture '+name+'\n')
        self.assertEqual((self.control/'spending-allowlist.json').read_text(),'do not change')
        self.assertEqual(result['source_commit'],self.sha)
    def test_bad_bundle_leaves_existing_pointer_and_code_intact(self):
        b.install(self.repo,self.control,self.sha,False);before=os.readlink(self.control/'controller-current')
        self.git('rm','deploy/macmini/release-bootstrap.mjs');sha=self.commit()
        with self.assertRaises(subprocess.CalledProcessError):b.install(self.repo,self.control,sha,False)
        self.assertEqual(os.readlink(self.control/'controller-current'),before)
        self.assertEqual((self.control/'deploy-release.sh').read_text(),'reviewed fixture deploy-release.sh\n')
    def test_unexpected_alias_rejected(self):
        (self.control/'deploy-release.sh').unlink();(self.control/'deploy-release.sh').symlink_to(self.root/'elsewhere')
        with self.assertRaises(RuntimeError):b.install(self.repo,self.control,self.sha,False)
        self.assertFalse((self.control/'controller-current').exists())
if __name__=='__main__':unittest.main()
