import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('task_review', Path(__file__).with_name('task-review.py'))
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        (self.repo / 'example.txt').write_text('before')
        self.commit()
        base = self.git('rev-parse', 'HEAD')
        (self.repo / 'example.txt').write_text('after')
        self.commit()
        snapshot = review.snapshot(self.repo, base)
        self.packet = {'schema': 1, 'task': 'Example fix', 'builder': 'builder-session', 'snapshot': snapshot,
            'brief': {**{k: 'Recorded supporting detail' for k in
                ('problem', 'desiredBehavior', 'scope', 'priorLessons', 'risk', 'recovery')},
                'acceptanceCriteria': ['The example behavior works']},
            'validation': [{'check': 'Fixture comparison', 'status': 'passed', 'head': snapshot['head'], 'evidence': 'fixture-report'}],
            'review': {'reviewer': 'reviewer-session', 'verdict': 'approved', 'evidence': 'review-report', 'findings': []},
            'acceptance': [{'criterion': 'The example behavior works', 'head': snapshot['head'], 'status': 'passed', 'evidence': 'behavior-report'}],
            'lesson': {**{k: 'Recorded lesson' for k in ('summary', 'cause', 'action', 'evidence', 'remaining', 'prevention', 'owner')}, 'outcome': 'fixed'}}
        self.packet['review']['subject'] = review.subject(self.packet)

    def git(self, *args):
        return review.git(self.repo, *args)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')

    def check(self, phase='accepted', packet=None):
        return review.check(packet or self.packet, self.repo, phase)

    def test_complete_packet_and_different_stages(self):
        self.assertTrue(self.check()['passed'])
        self.packet['review']['verdict'] = 'pending'
        self.assertTrue(self.check('prepared')['passed'])
        self.assertFalse(self.check('reviewed')['passed'])

    def test_source_changes_invalidate_review(self):
        (self.repo / 'example.txt').write_text('new')
        with self.assertRaises(ValueError):
            self.check()
        self.commit()
        self.assertFalse(self.check()['passed'])

    def test_untracked_file_and_unrelated_base_rejected(self):
        (self.repo / 'forgotten.txt').write_text('change')
        with self.assertRaises(ValueError):
            self.check()
        (self.repo / 'forgotten.txt').unlink()
        self.git('checkout', '--orphan', 'other')
        self.commit()
        with self.assertRaises(subprocess.CalledProcessError):
            self.check()

    def test_requirement_or_check_changes_invalidate_review(self):
        for mutate in ('requirement', 'check'):
            packet = copy.deepcopy(self.packet)
            if mutate == 'requirement':
                packet['brief']['scope'] = 'Expanded scope'
            else:
                packet['validation'][0]['evidence'] = 'Different report'
            self.assertFalse(self.check(packet=packet)['passed'])

    def test_builder_cannot_self_attest_and_open_findings_block(self):
        self.packet['review']['reviewer'] = ' BUILDER-SESSION '
        self.assertFalse(self.check()['passed'])
        self.packet['review']['reviewer'] = 'other'
        self.packet['review']['findings'] = [{'finding': 'A real bug', 'status': 'open', 'evidence': 'report'}]
        self.assertFalse(self.check()['passed'])

    def test_missing_acceptance_and_validation_fail(self):
        self.packet['acceptance'] = []
        self.assertFalse(self.check()['passed'])
        self.packet['validation'][0]['status'] = 'not-run'
        self.assertFalse(self.check('prepared')['passed'])

    def test_private_new_files_only(self):
        with self.assertRaises(ValueError):
            review.save_new(self.repo / 'private.json', {}, self.repo)
        target = self.root / 'private.json'
        review.save_new(target, {}, self.repo)
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            review.save_new(target, {}, self.repo)

    def test_draft_export_does_not_promote_unreviewed_work(self):
        packet_file = self.root / 'packet.json'
        output = self.root / 'lesson.json'
        self.packet['review']['verdict'] = 'pending'
        packet_file.write_text(json.dumps(self.packet))
        args = [sys.executable, str(Path(__file__).with_name('task-review.py')), 'lesson',
                '--repo', str(self.repo), '--packet', str(packet_file), '--output', str(output)]
        run = subprocess.run(args, capture_output=True)
        self.assertEqual(run.returncode, 2)
        self.assertFalse(output.exists())
        self.packet['lesson']['outcome'] = 'open'
        packet_file.write_text(json.dumps(self.packet))
        run = subprocess.run(args, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        record = json.loads(output.read_text())['records'][0]
        self.assertEqual(record['learning']['outcome'], 'open')
        self.assertNotIn('status', record)


if __name__ == '__main__':
    unittest.main()
