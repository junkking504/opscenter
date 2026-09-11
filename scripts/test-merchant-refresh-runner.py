import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('merchant_runner',Path(__file__).with_name('run-merchant-center-refresh.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class RunnerTests(unittest.TestCase):
    def test_failure_backoff_and_preservation(self):
        with tempfile.TemporaryDirectory() as tmp:
            r.ROOT=Path(tmp);r.DIRECTORY=Path(tmp)/'imports/merchant_center/junk_krewe'
            class Child:
                returncode=1
                def communicate(self,timeout):return ('','Merchant Center sign-in is required.')
            with patch.object(r.subprocess,'Popen',return_value=Child()) as run:
                self.assertEqual(r.main(),1)
                saved=json.loads((r.DIRECTORY/'refresh.json').read_text())
                self.assertEqual(saved['status'],'error')
                self.assertIn('sign-in',saved['message'])
                self.assertEqual(r.main(),0)
                self.assertEqual(run.call_count,1,'Do not hammer authentication on each app refresh')
                self.assertEqual(list(r.DIRECTORY.glob('transactions-*.json')),[])
    def test_timeout_targets_only_owned_group(self):
        with tempfile.TemporaryDirectory() as tmp:
            r.ROOT=Path(tmp);r.DIRECTORY=Path(tmp)/'imports/merchant_center/junk_krewe'
            class Child:
                pid=987654;returncode=-15
                calls=0
                def communicate(self,timeout):
                    self.calls+=1
                    if self.calls==1:raise r.subprocess.TimeoutExpired('collector',timeout)
                    return ('','')
            with patch.object(r.subprocess,'Popen',return_value=Child()) as run,patch.object(r.os,'killpg') as kill:
                self.assertEqual(r.main(),1)
                self.assertTrue(run.call_args.kwargs['start_new_session'])
                kill.assert_called_once_with(987654,r.signal.SIGTERM)

if __name__=='__main__':unittest.main()
