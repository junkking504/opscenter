#!/usr/bin/python3
"""Isolated supervision fixtures: no runtime configuration, Keychain or network."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest

HERE = Path(__file__).resolve().parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

supervisor = load('supervisor', 'supervise-web-push.py')
journal = load('journal', 'opscenter_push_journal.py')
CHILD = '''import json,os,time
from pathlib import Path
p=Path(os.environ['OPSCENTER_WEB_PUSH_READY_FILE'])
p.write_text(json.dumps({'nonce':os.environ['OPSCENTER_WEB_PUSH_RUN_NONCE'],'pid':os.getpid(),'ready':True,'reenableVersion':1}));p.chmod(0o600)
time.sleep(0.15)
'''

class SupervisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'journal').mkdir(mode=0o700)
        self.config = {'mode': 'observe', 'setupUntil': time.time() + 5}
        supervisor.atomic(self.root / 'sender.json', self.config)
        self.env = {'OPSCENTER_WEB_PUSH_ENABLED': '0', 'OPSCENTER_WEB_PUSH_PRIVATE_KEY': 'inherited-must-clear', 'OPSCENTER_PUSHOVER_CONFIG':'/private/pushover.json'}
    def tearDown(self):
        self.temp.cleanup()
    def forbidden_key(self):
        self.fail('observe mode must never request signing material')
    def test_observe_ready_then_exit_pauses_and_persists_off(self):
        calls=[]
        result=supervisor.supervise(self.root, self.env, [sys.executable, '-c', CHILD + "assert 'OPSCENTER_WEB_PUSH_PRIVATE_KEY' not in os.environ\nassert 'OPSCENTER_PUSHOVER_CONFIG' not in os.environ\nassert os.environ['OPSCENTER_PROCESS_ROLE']=='push-observer'\n"], lambda:calls.append(True), self.forbidden_key, .01)
        self.assertEqual(result,0)
        self.assertEqual(len(calls),2)
        self.assertFalse((self.root/'capture-lease.json').exists())
        self.assertEqual(json.loads((self.root/'sender.json').read_text())['mode'],'off')
        self.assertFalse(list(self.root.glob('ready-*')))
    def test_ongoing_requires_explicit_send_mode_and_retains_private_lease(self):
        config={'mode':'send','ongoing':True,'setupUntil':time.time()+86400}
        supervisor.atomic(self.root/'sender.json',config)
        result=supervisor.supervise(self.root,{'OPSCENTER_WEB_PUSH_ENABLED':'1','OPSCENTER_PUSHOVER_CONFIG':'/private/pushover.json'},[sys.executable,'-c',CHILD+"assert os.environ['OPSCENTER_PUSHOVER_CONFIG']=='/private/pushover.json'\n"],lambda:None,lambda:'synthetic-key',.01)
        self.assertEqual(result,0)
        self.assertEqual(json.loads((self.root/'sender.json').read_text())['mode'],'off')
        self.assertFalse((self.root/'capture-lease.json').exists())
        for config in [{'mode':'observe','ongoing':True,'setupUntil':time.time()+86400},
                       {'mode':'send','ongoing':True,'setupUntil':time.time()+31*86400},
                       {'mode':'send','setupUntil':time.time()+86400}]:
            supervisor.atomic(self.root/'sender.json',config)
            with self.assertRaises(ValueError):
                supervisor.supervise(self.root,{'OPSCENTER_WEB_PUSH_ENABLED':'1'},[],lambda:None,self.forbidden_key,.01)

    def test_supervisor_sigkill_stops_child_through_liveness_pipe(self):
        # A SIGKILLed supervisor runs no cleanup. The child must still notice,
        # through EOF on the inherited pipe, and must not linger with leadership.
        import signal, subprocess, stat as stat_module
        pid_file = self.root / 'child.pid'
        child = ('import json,os,stat,sys\nfrom pathlib import Path\n'
                 "fd=int(os.environ['OPSCENTER_WEB_PUSH_PARENT_FD'])\n"
                 'assert stat.S_ISFIFO(os.fstat(fd).st_mode)\n'
                 "p=Path(os.environ['OPSCENTER_WEB_PUSH_READY_FILE'])\n"
                 "p.write_text(json.dumps({'nonce':os.environ['OPSCENTER_WEB_PUSH_RUN_NONCE'],'pid':os.getpid(),'ready':True,'reenableVersion':1}));p.chmod(0o600)\n"
                 f"Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
                 'while os.read(fd,1):\n    pass\nsys.exit(7)\n')
        supervisor.atomic(self.root / 'sender.json', {'mode': 'observe', 'setupUntil': time.time() + 30})
        runner = ('import importlib.util,sys\nfrom pathlib import Path\n'
                  f"spec=importlib.util.spec_from_file_location('s',{str(HERE / 'supervise-web-push.py')!r});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n"
                  f"m.supervise(Path({str(self.root)!r}),{{'OPSCENTER_WEB_PUSH_ENABLED':'0'}},[sys.executable,'-c',{child!r}],lambda:None,None,.05)\n")
        process = subprocess.Popen([sys.executable, '-c', runner])
        try:
            deadline = time.time() + 10
            while not ((self.root / 'capture-lease.json').exists() and pid_file.exists()) and time.time() < deadline:
                time.sleep(.05)
            self.assertTrue((self.root / 'capture-lease.json').exists(), 'child became ready under supervision')
            child_pid = int(pid_file.read_text())
        finally:
            os.kill(process.pid, signal.SIGKILL); process.wait()
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                os.kill(child_pid, 0)
            except ProcessLookupError:
                break
            time.sleep(.05)
        else:
            os.kill(child_pid, signal.SIGKILL)
            self.fail('child outlived a SIGKILLed supervisor')
    def test_second_instance_cannot_remove_live_lease(self):
        supervisor.atomic(self.root/'capture-lease.json', {'sentinel':True})
        with (self.root/'supervisor.lock').open('w') as lock:
            os.chmod(lock.name,0o600);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                supervisor.supervise(self.root,self.env,[],lambda:None,self.forbidden_key,.01)
        self.assertEqual(json.loads((self.root/'capture-lease.json').read_text()),{'sentinel':True})
        self.assertEqual(json.loads((self.root/'sender.json').read_text()),self.config)
    def test_pause_failure_still_persists_off(self):
        calls=[]
        def pause():
            calls.append(True)
            if len(calls)==2:raise RuntimeError('synthetic pause failure')
        with self.assertRaises(RuntimeError):
            supervisor.supervise(self.root,self.env,[sys.executable,'-c',CHILD],pause,self.forbidden_key,.01)
        self.assertFalse((self.root/'capture-lease.json').exists())
        self.assertEqual(json.loads((self.root/'sender.json').read_text())['mode'],'off')
    def test_operator_off_stops_own_child(self):
        seen=[]
        def edit():
            for _ in range(200):
                if (self.root/'capture-lease.json').exists():
                    seen.append(json.loads((self.root/'capture-lease.json').read_text()))
                    supervisor.atomic(self.root/'sender.json',{**self.config,'mode':'off'})
                    return
                time.sleep(.01)
        thread=threading.Thread(target=edit);thread.start()
        try:supervisor.supervise(self.root,self.env,[sys.executable,'-c',CHILD.replace('0.15','10')],lambda:None,self.forbidden_key,.01)
        finally:thread.join()
        self.assertEqual(seen[0]['mode'],'observe')
        self.assertEqual(seen[0]['reenableVersion'],1)
        self.assertFalse((self.root/'capture-lease.json').exists())
    def test_startup_failure_never_grants_lease(self):
        self.assertEqual(supervisor.supervise(self.root,self.env,[sys.executable,'-c','raise SystemExit(1)'],lambda:None,self.forbidden_key,.01),1)
        self.assertFalse((self.root/'capture-lease.json').exists())
    def test_setup_expiry_stops_without_starting_a_trial(self):
        supervisor.atomic(self.root/'sender.json',{**self.config,'setupUntil':time.time()+.2})
        started=time.time()
        supervisor.supervise(self.root,self.env,[sys.executable,'-c',CHILD.replace('0.15','10')],lambda:None,self.forbidden_key,.01)
        self.assertLess(time.time()-started,2)
        self.assertFalse((self.root/'capture-lease.json').exists())
        self.assertEqual(json.loads((self.root/'sender.json').read_text())['mode'],'off')
    def test_send_requires_explicit_mode_configuration(self):
        supervisor.atomic(self.root/'sender.json',{**self.config,'mode':'send'})
        with self.assertRaisesRegex(ValueError,'mode_configuration_mismatch'):
            supervisor.supervise(self.root,self.env,[],lambda:None,self.forbidden_key,.01)
    def test_persistent_sender_has_no_setup_deadline(self):
        config={'mode':'send','persistent':True}
        supervisor.atomic(self.root/'sender.json',config)
        env={**self.env,'OPSCENTER_WEB_PUSH_ENABLED':'1'}
        # Mock key and child: never access Keychain or a provider.
        self.assertEqual(supervisor.supervise(self.root,env,[sys.executable,'-c',CHILD],lambda:None,lambda:'x'*43,.01),0)
        self.assertEqual(json.loads((self.root/'sender.json').read_text()),{**config,'mode':'off'})
        supervisor.atomic(self.root/'sender.json',{**config,'setupUntil':time.time()+20})
        with self.assertRaisesRegex(ValueError,'persistent_send_only'):
            supervisor.supervise(self.root,env,[],lambda:None,lambda:'x'*43,.01)

    def test_environment_excludes_secrets_and_does_not_execute(self):
        file=self.root/'environment'
        file.write_text('OPS_AUTH_USERNAME=fixture\nOPSCENTER_PUSHOVER_CONFIG="/private/config with spaces.json"\nPUSHOVER_TOKEN=private\nOPS_AUTH_PASSWORD_HASH=private\nOPSCENTER_WEB_PUSH_PRIVATE_KEY=private\nSLACK_TOKEN=private\nOPSCENTER_WEB_PUSH_ENABLED=0\nOPS_AUTH_ROLE_BINDINGS="$(never-execute)"\n');file.chmod(0o600)
        value=supervisor.environment(file)
        self.assertEqual(value['OPS_AUTH_ROLE_BINDINGS'],'$(never-execute)')
        self.assertEqual(value['OPSCENTER_PUSHOVER_CONFIG'],'/private/config with spaces.json')
        self.assertNotIn('PUSHOVER_TOKEN',value)
        self.assertFalse({'OPS_AUTH_PASSWORD_HASH','SLACK_TOKEN','OPSCENTER_WEB_PUSH_PRIVATE_KEY'} & value.keys())
    def test_capture_lease_fails_closed(self):
        lease=self.root/'capture-lease.json'
        good={'version':1,'mode':'observe','nonce':'a'*32,'expiresAt':104}
        supervisor.atomic(lease,good)
        self.assertEqual(journal.capture_lease(self.root,100),self.root/'journal')
        for update in ({'expiresAt':100},{'expiresAt':111},{'expiresAt':float('nan')},{'mode':'off'},{'nonce':'bad'}):
            supervisor.atomic(lease,{**good,**update})
            self.assertIsNone(journal.capture_lease(self.root,100))
        supervisor.atomic(lease,good);lease.chmod(0o644)
        self.assertIsNone(journal.capture_lease(self.root,100))
        lease.unlink();lease.symlink_to(self.root/'sender.json')
        self.assertIsNone(journal.capture_lease(self.root,100))

if __name__=='__main__':unittest.main()
