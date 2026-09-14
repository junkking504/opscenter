import copy
import importlib.util
from pathlib import Path
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

spec = importlib.util.spec_from_file_location('observer', Path(__file__).resolve().parents[1] / 'deploy/vps/continuity-monitor.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW = 1800000000

def healthy():
    return dict(primary=dict(observedAt=m.stamp(NOW), release='a'*40, publication=dict(status='success', fileLastSuccessAt=m.stamp(NOW), financialStatementsSyncedAt=m.stamp(NOW))),
        app=dict(running=True, revision='a'*40), standby=dict(runtime='VPS', platformKernel=dict(healthy=True, databaseName='opscenter_recovery_20260914'), assignmentStoreWritable=False, operatorStateWritable=False),
        gateway=dict(mode='primary', standbyReady=True), origin=dict(runtime='MISSION_CONTROL', platformKernel=dict(healthy=True)),
        public=dict(runtime='MISSION_CONTROL', platformKernel=dict(healthy=True)), login=dict(code=200, loginForm=True),
        receipt=dict(snapshotAt=m.stamp(NOW)), disk=dict(free=10*1024**3, total=50*1024**3))

def status(inputs, key):
    return next(r for r in m.checks(inputs, NOW) if r['key'] == key)['status']

class Tests(unittest.TestCase):
    def test_good_and_version_mismatch(self):
        data = healthy()
        self.assertTrue(all(r['status'] == 'ok' for r in m.checks(data, NOW)))
        data['app']['revision'] = 'b'*40
        self.assertEqual(status(data, 'version'), 'warn')
    def test_unknown_future_and_stale_primary(self):
        for at in (None, 'invalid', m.stamp(NOW+1), m.stamp(NOW-181)):
            data = healthy(); data['primary']['observedAt'] = at
            self.assertEqual(status(data, 'version'), 'unknown')
            self.assertEqual(status(data, 'files'), 'unknown')
    def test_standby_boundaries(self):
        for field, value in [('runtime', 'MISSION_CONTROL'), ('assignmentStoreWritable', True), ('operatorStateWritable', True), ('platformKernel', dict(healthy=True, databaseName='opscenter_production'))]:
            data = healthy(); data['standby'][field] = value
            self.assertEqual(status(data, 'standby'), 'warn')
        data = healthy(); data['app']['running'] = False
        self.assertEqual(status(data, 'standby'), 'warn')
    def test_public_is_separate(self):
        for login in (None, dict(code=302, loginForm=True), dict(code=200, loginForm=False)):
            data = healthy(); data['login'] = login
            self.assertEqual(status(data, 'public'), 'warn')
            self.assertEqual(status(data, 'primary-origin'), 'ok')
    def test_backup_independence(self):
        data = healthy(); data['receipt']['snapshotAt'] = m.stamp(NOW-601)
        self.assertEqual(status(data, 'database'), 'warn'); self.assertEqual(status(data, 'files'), 'ok')
        data['primary']['publication']['status'] = 'failed'
        self.assertEqual(status(data, 'files'), 'warn')
        data['primary']['publication']['fileLastSuccessAt'] = m.stamp(NOW+2)
        self.assertEqual(status(data, 'files'), 'unknown')
    def test_disk(self):
        data = healthy(); data['disk']['free'] = 1024**3
        self.assertEqual(status(data, 'disk'), 'warn')
    def test_confirmation_recovery_unknown_and_dedup(self):
        rows = [dict(key='version', status='warn')]
        state = m.reconcile(None, rows, NOW)
        self.assertEqual(state['incidents'][0]['status'], 'confirming')
        same = copy.deepcopy(state)
        self.assertEqual(m.reconcile(state, rows, NOW+10), same)
        state = m.reconcile(state, rows, NOW+60)
        self.assertEqual(state['incidents'][0]['status'], 'open')
        state = m.reconcile(state, [dict(key='version', status='ok')], NOW+120)
        self.assertEqual(state['status'], 'attention')
        state = m.reconcile(state, [dict(key='version', status='unknown')], NOW+180)
        self.assertEqual(state['incidents'][0]['goodChecks'], 0)
        for t in (240, 300, 360):
            state = m.reconcile(state, [dict(key='version', status='ok')], NOW+t)
        self.assertEqual(state['incidents'][0]['status'], 'resolved')
        self.assertEqual(state['status'], 'ready')
        self.assertEqual(len(state['receipts']), 2)
        state = m.reconcile(state, rows, NOW+420)
        self.assertEqual(state['incidents'][0]['occurrences'], 2)
    def test_corrupt_ledger_not_reset(self):
        original = dict(version=99, incidents=[], receipts=[])
        with self.assertRaises(ValueError): m.reconcile(original, [], NOW)
        self.assertEqual(original['version'], 99)
    def test_http_probe_rejects_redirect_and_wrong_content(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                if self.path == '/redirect':
                    self.send_response(302); self.send_header('Location', '/login'); self.end_headers(); return
                self.send_response(503 if self.path == '/health' else 200); self.end_headers()
                self.wfile.write(b'{"runtime":"VPS"}' if self.path == '/health' else b'<form action="/api/auth/login"><input name="username"><input name="password"></form>' if self.path == '/login' else b'not opscenter')
        server = HTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        root = 'http://127.0.0.1:' + str(server.server_port)
        try:
            self.assertTrue(m.probe(root+'/login', True)['loginForm'])
            self.assertEqual(m.probe(root+'/redirect', True)['code'], 302)
            self.assertFalse(m.probe(root+'/wrong', True)['loginForm'])
            self.assertEqual(m.probe(root+'/health')['runtime'], 'VPS')
        finally: server.shutdown(); server.server_close(); worker.join()

if __name__ == '__main__': unittest.main()
