"""Real-zsh scheduler regressions. GitHub, Git and release operations are offline stubs."""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'deploy/macmini/auto-ship.sh'
ZSH = shutil.which('zsh')
if not ZSH:
    raise SystemExit('zsh is required; do not substitute bash')

STUB = r'''import json,os,sys,time
from pathlib import Path
name=Path(sys.argv[0]).name
args=sys.argv[1:]
root=Path(os.environ['TEST_ROOT'])
settings=json.loads((root/'settings.json').read_text())
with (root/'calls.jsonl').open('a') as f:
 f.write(json.dumps([name,args,str(Path.cwd())])+'\n')
if name=='gh':
 if args[:2]==['pr','list']:
  assert Path.cwd()==root/'work', 'queue lookup outside repository'
  if settings.get('list_fail'):sys.exit(2)
  assert '--limit' in args and args[args.index('--limit')+1]=='1000'
  assert 'sort_by(.createdAt' in args[-1]
  print('\n'.join(str(p) for p in settings.get('queue',[42])))
 elif args[:2]==['pr','view']:
  if settings.get('view_fail'):sys.exit(2)
  print(settings.get('state','OPEN'))
 elif args[:2]==['pr','edit']:
  if '--remove-label' in args and settings.get('remove_fail'):sys.exit(2)
  if '--add-label' in args and settings.get('add_fail'):sys.exit(2)
 elif args[:2]==['pr','comment']:
  if settings.get('comment_fail'):sys.exit(2)
 else:sys.exit(98)
elif name=='git':
 if args[0]=='status':
  if settings.get('status_fail'):sys.exit(2)
  if settings.get('dirty'):print(' M deploy/macmini/ship.sh')
 elif args[0]=='fetch':
  if settings.get('fetch_fail'):sys.exit(2)
 elif args[0]=='checkout':
  if settings.get('checkout_fail'):sys.exit(2)
 elif args[0]=='rev-parse':print('abc1234')
 else:sys.exit(98)
elif name=='ship.sh':
 (root/'entered').touch()
 if settings.get('hold'):
  deadline=time.monotonic()+10
  while not (root/'proceed').exists():
   if time.monotonic()>deadline:sys.exit(97)
   time.sleep(.02)
 if settings.get('pause_after')==args[0]:(root/'config'/'auto-ship.off').touch()
 if settings.get('lock_after')==args[0]:(root/'deploy-lock').touch()
 mode=settings.get('modes',{}).get(args[0],'ok')
 reasons={'pending':'CI is not fully green (1 checks pending or failing)',
 'conflict':f'PR #{args[0]} has conflicts or is not mergeable yet',
 'gate':'review approval is missing; production was not changed',
 'stop':"Claude's review says stop (label claude-stop). Fix it or remove the label.",
 'stale':'merge current production into the PR and review it first'}
 if mode in reasons:
  print('ship stopped: '+reasons[mode],file=sys.stderr);sys.exit(1)
 if mode=='deploy-fails':print('Deploying abc1234');sys.exit(1)
 if mode=='crash':sys.exit(9)
 print('Deployed abc1234')
'''


class Fixture:
    def __init__(self, **settings):
        self.tmp = tempfile.TemporaryDirectory(prefix='auto-ship-zsh-')
        self.root = Path(self.tmp.name).resolve()
        self.config = self.root / 'config'
        self.work = self.root / 'work'
        self.bin = self.root / 'bin'
        scripts = self.work / 'deploy/macmini'
        for directory in (self.config, self.bin, scripts):
            directory.mkdir(parents=True)
        for file in (self.bin/'gh', self.bin/'git', scripts/'ship.sh'):
            file.write_text(f'#!{sys.executable}\n'+STUB)
            file.chmod(0o755)
        self.settings = settings
        self.save()
        # No inherited credentials or production overrides; every mutable path
        # and every effectful executable resolves inside this disposable fixture.
        self.env = dict(PATH='/usr/bin:/bin', TEST_ROOT=str(self.root),
                        AUTO_SHIP_EXTRA_PATH=str(self.bin),
                        AUTO_SHIP_CONFIG_DIR=str(self.config),
                        AUTO_SHIP_WORKTREE=str(self.work),
                        AUTO_SHIP_DEPLOY_LOCK=str(self.root/'deploy-lock'),
                        AUTO_SHIP_MIN_INTERVAL_SECONDS='3600')
        self.processes = []

    def save(self):
        (self.root/'settings.json').write_text(json.dumps(self.settings))

    def start(self):
        process = subprocess.Popen([ZSH, '-f', str(SOURCE)], env=self.env,
                                   cwd=self.root, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, start_new_session=True)
        self.processes.append(process)
        return process

    def finish(self, process, expected=0):
        out, err = process.communicate(timeout=15)
        assert process.returncode == expected, (process.returncode, out, err)
        assert not (self.config/'auto-ship.lock').exists(), 'owned lock leaked'

    def run(self, expected=0):
        self.finish(self.start(), expected)

    def calls(self):
        file = self.root/'calls.jsonl'
        return [json.loads(line) for line in file.read_text().splitlines()] if file.exists() else []

    def ships(self):
        return [args[0] for name,args,_ in self.calls() if name=='ship.sh']

    def effects(self):
        return '\n'.join(' '.join(args) for name,args,_ in self.calls() if name=='gh' and args[1] in ('edit','comment'))

    def exists(self, name):
        return (self.config/('auto-ship.'+name)).exists()

    def wait_entered(self):
        deadline = time.monotonic()+5
        while not (self.root/'entered').exists():
            if time.monotonic()>deadline:
                raise AssertionError('stub release did not start')
            time.sleep(.02)

    def close(self):
        for process in self.processes:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
        self.tmp.cleanup()


class AutoShipTests(unittest.TestCase):
    def fixture(self, **settings):
        fixture=Fixture(**settings)
        self.addCleanup(fixture.close)
        return fixture

    def test_success_and_cooldown(self):
        f=self.fixture(queue=[42,43])
        f.run()
        self.assertEqual(f.ships(), ['42'])
        self.assertTrue(f.exists('last'))
        self.assertFalse(f.exists('inflight'))
        self.assertIn('pr edit 42 --remove-label ready-to-ship', f.effects())
        self.assertIn('merged and deployed', f.effects())
        f.run()
        self.assertEqual(f.ships(), ['42'])

    def test_waiting_candidates_do_not_block_oldest_eligible(self):
        f=self.fixture(queue=[92,99,102,103], modes={'92':'conflict','99':'pending'})
        f.run()
        self.assertEqual(f.ships(), ['92','99','102'])
        self.assertNotIn('pr edit 92', f.effects())
        self.assertNotIn('pr edit 99', f.effects())
        self.assertIn('pr edit 102', f.effects())

    def test_all_waiting_and_empty_queue(self):
        for queue in ([],[92,102]):
            with self.subTest(queue=queue):
                f=self.fixture(queue=queue, modes={'92':'conflict','102':'pending'})
                f.run()
                self.assertEqual(f.ships(), [str(p) for p in queue])
                self.assertFalse(f.exists('last'))
                self.assertFalse(f.exists('inflight'))
                self.assertEqual(f.effects(), '')

    def test_terminal_failures_stop_tick(self):
        for mode in ('gate','stop','stale','deploy-fails','crash'):
            with self.subTest(mode=mode):
                f=self.fixture(queue=[42,43],modes={'42':mode},state='MERGED')
                f.run()
                self.assertEqual(f.ships(), ['42'])
                self.assertTrue(f.exists('last'))
                self.assertFalse(f.exists('inflight'))
                self.assertIn('--add-label ship-failed',f.effects())
                self.assertIn('PR state: MERGED',f.effects())
                self.assertNotIn('merged and deployed',f.effects())

    def test_remote_bookkeeping_failures(self):
        for failed in ('remove_fail','add_fail','view_fail','comment_fail'):
            with self.subTest(failed=failed):
                f=self.fixture(modes={'42':'gate'},**{failed:True})
                blocked=failed in ('remove_fail','add_fail')
                f.run(1 if blocked else 0)
                self.assertEqual(f.exists('inflight'),blocked)
                self.assertTrue(f.exists('last'))
                if failed=='view_fail':
                    self.assertIn('PR state: UNKNOWN', f.effects())
                if blocked:
                    f.run(1)
                    self.assertEqual(f.ships(),['42'])

    def test_preflight_errors_cleanup_without_release(self):
        for failed in ('list_fail','status_fail','fetch_fail','checkout_fail','dirty'):
            with self.subTest(failed=failed):
                f=self.fixture(**{failed:True})
                f.run(1 if failed=='dirty' else 2)
                self.assertEqual(f.ships(), [])
                self.assertFalse(f.exists('inflight'))
                self.assertFalse(f.exists('last'))

    def test_pause_deploy_lock_and_unknown_outcome(self):
        for name in ('off','inflight','deploy-lock'):
            with self.subTest(name=name):
                f=self.fixture()
                path=f.root/name if name=='deploy-lock' else f.config/('auto-ship.'+name)
                path.touch()
                f.run(1 if name=='inflight' else 0)
                self.assertEqual(f.calls(),[])
                self.assertTrue(path.exists())

    def test_cooldown_uses_seconds_and_rejects_bad_config(self):
        f=self.fixture()
        stamp=f.config/'auto-ship.last'
        stamp.touch()
        now=time.time()
        os.utime(stamp,(now-30,now-30))
        f.env['AUTO_SHIP_MIN_INTERVAL_SECONDS']='59'
        f.run()
        self.assertEqual(f.ships(),[])
        os.utime(stamp,(now-60,now-60))
        f.run()
        self.assertEqual(f.ships(),['42'])
        f.env['AUTO_SHIP_MIN_INTERVAL_SECONDS']='invalid'
        f.run(1)

    def test_simultaneous_runs_and_post_lock_cooldown(self):
        f=self.fixture(hold=True)
        first=f.start()
        f.wait_entered()
        second=f.start()
        out,err=second.communicate(timeout=5)
        self.assertEqual(second.returncode,0,(out,err))
        self.assertTrue(f.exists('lock'),'contender removed owner lock')
        self.assertEqual(f.ships(),['42'])
        (f.root/'proceed').touch()
        f.finish(first)
        f.run()
        self.assertEqual(f.ships(),['42'])

    def test_signal_releases_lock_but_requires_reconciliation(self):
        f=self.fixture(hold=True)
        process=f.start()
        f.wait_entered()
        os.killpg(process.pid,signal.SIGTERM)
        f.finish(process,143)
        self.assertTrue(f.exists('inflight'))
        self.assertFalse(f.exists('last'))
        f.run(1)
        self.assertEqual(f.ships(),['42'])

    def test_pause_or_deploy_lock_between_candidates(self):
        for setting in ('pause_after','lock_after'):
            with self.subTest(setting=setting):
                f=self.fixture(queue=[92,102],modes={'92':'pending'},**{setting:'92'})
                f.run()
                self.assertEqual(f.ships(),['92'])
                self.assertFalse(f.exists('inflight'))
                self.assertFalse(f.exists('last'))

    def test_killed_scheduler_never_replays_uncertain_release(self):
        f=self.fixture(hold=True)
        process=f.start()
        f.wait_entered()
        os.killpg(process.pid,signal.SIGKILL)
        process.communicate(timeout=5)
        self.assertTrue(f.exists('lock'))
        self.assertTrue(f.exists('inflight'))
        contender=f.start()
        contender.communicate(timeout=5)
        self.assertEqual(contender.returncode,0)
        self.assertEqual(f.ships(),['42'])

    def test_foreign_lock_is_preserved(self):
        f=self.fixture()
        lock=f.config/'auto-ship.lock'
        lock.mkdir()
        process=f.start()
        process.communicate(timeout=5)
        self.assertEqual(process.returncode,0)
        self.assertTrue(lock.exists())
        self.assertEqual(f.calls(),[])


if __name__=='__main__':
    unittest.main(verbosity=2)
