import os
from pathlib import Path
import subprocess,tempfile,unittest
source=(Path(__file__).resolve().parents[1]/'deploy/macmini/deploy-release.sh').read_text()
block=source[source.index('SLOT_MODE="legacy"'):source.index('active_release="$(readlink "$APP_LINK")"',source.index('SLOT_MODE="legacy"'))]
class ModeTests(unittest.TestCase):
 def test_bad_or_failed_mode_cannot_reach_build_or_restart(self):
  with tempfile.TemporaryDirectory() as temp:
   (Path(temp)/'.release-slots').mkdir()
   shell='set -euo pipefail\nSCRIPT_DIR=/fixture\nfail(){ exit 78; }\nnode(){ print -rn -- "$FIXTURE_MODE"; return "$FIXTURE_EXIT"; }\n'+block+'\nprint reached-build-or-restart\n'
   for mode,code,allowed in [('',0,False),('garbage',0,False),('legacy\nslots',0,False),('legacy',1,False),('slots',2,False),('bootstrap-incomplete',0,False),('legacy',0,True),('slots',0,True)]:
    with self.subTest(mode=mode,code=code):
     result=subprocess.run(['/bin/zsh','-c',shell],capture_output=True,text=True,env=dict(os.environ,DEPLOY_ROOT=temp,FIXTURE_MODE=mode,FIXTURE_EXIT=str(code)))
     self.assertEqual(result.returncode==0,allowed,result.stderr)
     self.assertEqual('reached-build-or-restart' in result.stdout,allowed)
if __name__=='__main__':unittest.main()
