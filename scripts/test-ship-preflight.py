"""Offline execution of the ship wrapper; all GitHub/Git/deploy effects are stubbed."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

source = Path('deploy/macmini/ship.sh').read_text()
with tempfile.TemporaryDirectory(prefix='ship-preflight-') as temporary:
    root = Path(temporary)
    bindir = root / 'bin'
    scripts = root / 'deploy/macmini'
    active = root / 'active'
    for folder in (bindir, scripts, active):
        folder.mkdir(parents=True)
    def executable(file, content):
        file.write_text(content)
        file.chmod(0o755)
    stub = '''#!/usr/bin/python3
import json,os,sys
from pathlib import Path
name=Path(sys.argv[0]).name
with open(os.environ['SHIP_TEST_LOG'],'a') as f:f.write(name+' '+ ' '.join(sys.argv[1:])+'\\n')
mode=os.environ.get('SHIP_TEST_MODE','ok')
if name=='gh':
 if sys.argv[1:3]==['pr','view']:print(json.dumps(dict(state='OPEN',baseRefName='production',mergeable='MERGEABLE',isDraft=False,labels=[dict(name='claude-stop')] if mode=='stop' else [],statusCheckRollup=[dict(conclusion='FAILURE' if mode=='ci' else 'SUCCESS')],headRefOid='a'*40)))
 elif sys.argv[1:3]==['pr','merge']:sys.exit(0)
 else:sys.exit(99)
elif name=='git':
 args=sys.argv[1:]
 if args[0]=='-C':print('b'*40)
 elif args[0]=='fetch':pass
 elif args[0]=='rev-parse':print(('c' if mode=='moved' else 'a')*40)
 elif args[0]=='merge-base':sys.exit(1 if mode=='stale' else 0)
 else:sys.exit(99)
'''
    executable(bindir/'gh', stub)
    executable(bindir/'git', stub)
    executable(scripts/'deploy-from-macbook.sh', '#!/bin/zsh\nprint -r -- "launcher $OPSCENTER_MC_HOST $*" >> "$SHIP_TEST_LOG"\n')
    # Rewrite locations only in the isolated copy; production has fixed paths.
    fixture = source.replace('export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"', f'export PATH="{bindir}:/usr/bin:/bin:/usr/sbin:/sbin"')
    fixture = fixture.replace('/Users/missioncontrol/opscenter-v2/opscenter',str(active))
    executable(scripts/'ship.sh', fixture)
    log=root/'effects'
    for mode,arguments,success in [('stop',[],False),('moved',[],False),('stale',[],False),('ci',[],False),('ok',['--dry-run'],True),('ok',[],True)]:
        log.write_text('')
        env={**os.environ,'SHIP_TEST_LOG':str(log),'SHIP_TEST_MODE':mode,'OPSCENTER_CONTROLLER':'/never/run/a/branch/controller'}
        result=subprocess.run(['/bin/zsh',str(scripts/'ship.sh'),'73',*arguments],env=env,capture_output=True,text=True)
        assert (result.returncode==0)==success,(mode,arguments,result.stderr)
        effects=log.read_text()
        if mode!='ok' or arguments:
            assert 'gh pr merge' not in effects and 'launcher ' not in effects,(mode,effects)
        else:
            assert 'gh pr merge 73 --merge --match-head-commit '+'a'*40 in effects,effects
            assert effects.index('gh pr merge')<effects.index('launcher 127.0.0.1 origin/production'),effects
        assert 'gate\n' not in effects
        assert '/never/run' not in effects
print('PASS: ship refuses explicit stops, moved, stale and failed-CI heads before merging; dry run has no writes; a head with no receipt or installed review checker merges before the fixed launcher, ignoring controller overrides. Offline stubs only.')
