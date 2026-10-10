import importlib.util,json,os
from pathlib import Path
import tempfile,unittest
source=Path(__file__).resolve().parent/'legacy-launch-guard.py'
spec=importlib.util.spec_from_file_location('guard',source);g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
class GuardTests(unittest.TestCase):
 def test_missing_allows_but_blocked_and_corrupt_fail_closed(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp).resolve()/'state';self.assertTrue(g.allowed(root));root.mkdir(mode=0o700)
   file=root/'legacy-launch.json'
   for blocked in (False,True):
    file.write_text(json.dumps({'version':1,'blocked':blocked,'sha':'a'*40}));file.chmod(0o600);self.assertEqual(g.allowed(root),not blocked)
   file.write_text('{}')
   with self.assertRaises(ValueError):g.allowed(root)
   file.unlink();file.symlink_to('/dev/null')
   with self.assertRaises(OSError):g.allowed(root)
 def test_guard_precedes_secrets_pid_lock_and_server(self):
  script=(source.parent/'run_opscenter.sh').read_text();guard=script.index('python3 "$APP_DIR/scripts/legacy-launch-guard.py"')
  for operation in ('source "$ENV_FILE"','source "$APP_DIR/scripts/load-opscenter-secrets.sh"','mkdir "$LOCK_DIR"','exec ./node_modules/.bin/next start'):self.assertLess(guard,script.index(operation))
if __name__=='__main__':unittest.main()
