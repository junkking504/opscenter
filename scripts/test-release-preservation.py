"""Exercise the real retention function with a destructive test double in temp data."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
CONTROLLER=(ROOT/'deploy/macmini/deploy-release.sh').read_text()
FUNCTION=CONTROLLER.split('prune_superseded_releases() {',1)[1].split('\n}\n',1)[0]

class PreservationTests(unittest.TestCase):
    def test_launcher_forwards_preservation_to_installed_controller(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);key=root/'key';key.touch();record=root/'ssh-call'
            (root/'git').write_text('''#!/bin/sh
case "$*" in
  *--is-inside-work-tree*) echo true;;
  *rev-parse*) echo 1234567890123456789012345678901234567890;;
  *get-url*) echo https://example.invalid/repository;;
esac
''')
            (root/'ssh').write_text('''#!/bin/sh
case "$*" in
  *" -s "*) printf '%s\\n' "$@" > "$RECORD"; cat >> "$RECORD";;
esac
''')
            for name in ('git','ssh'):(root/name).chmod(0o700)
            env={**os.environ,'PATH':temp+':/usr/bin:/bin','OPSCENTER_MC_SSH_KEY':str(key),'RECORD':str(record)}
            env.pop('OPSCENTER_PRESERVE_RELEASES',None);env.pop('OPSCENTER_MC_HOST',None)
            result=subprocess.run(['/bin/zsh',str(ROOT/'deploy/macmini/deploy-from-macbook.sh'),'fixture.invalid','HEAD'],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            sent=record.read_text()
            self.assertIn('1234567890123456789012345678901234567890\ntrue\ntrue\n',sent)
            self.assertIn('export OPSCENTER_PRESERVE_RELEASES="$3"',sent)
            self.assertIn('deployment-control/deploy-release.sh',sent)

    def test_both_retention_phases_preserve_every_release_by_default(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for i in range(17):(root/str(i)).write_text('existing release')
            # Executing the cleanup double would destroy the fixture inventory.
            script='PRESERVE_RELEASES="${OPSCENTER_PRESERVE_RELEASES:-true}"\n'
            script+='python3() { /bin/rm -f "$FIXTURE"/*; }\n'
            script+='prune_superseded_releases() {'+FUNCTION+'\n}\n'
            script+='prune_superseded_releases old old\nprune_superseded_releases new old\n'
            env={**os.environ,'FIXTURE':temp};env.pop('OPSCENTER_PRESERVE_RELEASES',None)
            result=subprocess.run(['/bin/zsh','-eu','-c',script],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(len(list(root.iterdir())),17)
            self.assertEqual(result.stdout.count('retention skipped'),2)
            # Explicit opt-in still reaches retention, proving the test double is live.
            env.update(OPSCENTER_PRESERVE_RELEASES='false',SCRIPT_DIR=temp)
            result=subprocess.run(['/bin/zsh','-eu','-c',script],env=env,capture_output=True,text=True)
            self.assertEqual(len(list(root.iterdir())),0)
    def test_invalid_setting_stops_before_deployment(self):
        env={**os.environ,'OPSCENTER_PRESERVE_RELEASES':'FALSE'}
        for name in ('deploy-from-macbook.sh','deploy-release.sh'):
            result=subprocess.run(['/bin/zsh',str(ROOT/'deploy/macmini'/name),'invalid'],env=env,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('OPSCENTER_PRESERVE_RELEASES must be true or false',result.stderr)

if __name__=='__main__':unittest.main()
