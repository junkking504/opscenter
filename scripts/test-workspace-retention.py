#!/usr/bin/env python3
"""Exercise destructive boundaries against disposable, real Git worktrees."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

source = Path(__file__).resolve().parents[1] / 'deploy/macmini/workspace-retention.py'
spec = importlib.util.spec_from_file_location('retention', source)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'repository'
        self.repo.mkdir()
        r.run('git', 'init', '-q', self.repo)
        r.git(self.repo, 'config', 'user.email', 'test@example.invalid')
        r.git(self.repo, 'config', 'user.name', 'Retention test')
        (self.repo / '.gitignore').write_text('node_modules/\n.next*/\ntmp/\n.env.local\n.opscenter-release\n')
        (self.repo / 'source.txt').write_text('preserve me\n')
        (self.repo / 'package.json').write_text('{}\n')
        r.git(self.repo, 'add', '.')
        r.git(self.repo, 'commit', '-qm', 'base')
        for name in ('worktrees', 'releases', 'preview-releases'):
            (self.root / name).mkdir()
        self.production = self.add('releases', 'active')
        self.preview = self.add('preview-releases', 'active')
        (self.root / 'opscenter').symlink_to(self.production)
        (self.root / 'opscenter-preview').symlink_to(self.preview)
        self.now = time.time() + 10 * r.DAY

    def tearDown(self):
        self.temp.cleanup()

    def add(self, group, name):
        p = self.root / group / name
        r.git(self.repo, 'worktree', 'add', '--detach', str(p), 'HEAD')
        return p

    def generated(self, p, name='node_modules'):
        target = p / name
        target.mkdir(parents=True)
        (target / 'generated').write_text('rebuildable\n')
        return target

    def engine(self, paths=()):
        return r.Retention(self.root, process_scan=lambda: list(paths), now=self.now)

    def test_default_report_never_deletes(self):
        p = self.add('worktrees', 'paused')
        target = self.generated(p)
        events = self.engine().execute(scope='worktrees')
        self.assertTrue(target.exists())
        self.assertTrue(any(e['action'] == 'would-remove-generated' for e in events))

    def test_paused_task_cleans_builds_preserving_dirty_source_and_unpushed_commit(self):
        p = self.add('worktrees', 'paused')
        (p / 'source.txt').write_text('unique commit\n')
        r.git(p, 'add', 'source.txt'); r.git(p, 'commit', '-qm', 'unique work')
        (p / 'source.txt').write_text('unfinished edits\n')
        target = self.generated(p)
        build = self.generated(p, 'tmp/macmini-preview-next')
        self.engine().execute(True, 'worktrees')
        self.assertFalse(target.exists()); self.assertFalse(build.exists())
        self.assertEqual((p / 'source.txt').read_text(), 'unfinished edits\n')
        self.assertEqual(r.git(p, 'log', '-1', '--format=%s').strip(), 'unique work')

    def test_recent_task_preserved(self):
        p = self.add('worktrees', 'recent'); target = self.generated(p)
        e = self.engine(); e.now = time.time()
        e.execute(True, 'worktrees')
        self.assertTrue(target.exists())

    def test_live_cwd_and_nested_open_files_protect_whole_task(self):
        p = self.add('worktrees', 'running'); target = self.generated(p)
        for live in (p, target / 'generated'):
            self.engine([live]).execute(True, 'worktrees')
            self.assertTrue(target.exists())

    def test_new_process_before_delete_preserves_target(self):
        p = self.add('worktrees', 'race'); target = self.generated(p)
        e = self.engine(); calls = []
        def scan():
            calls.append(1)
            return [] if len(calls) == 1 else [p]
        e.scan = scan
        e.execute(True, 'worktrees')
        self.assertTrue(target.exists())

    def test_scan_failure_deletes_nothing(self):
        p = self.add('worktrees', 'unknown'); target = self.generated(p)
        e = self.engine()
        def broken(): raise RuntimeError('scan timed out')
        e.scan = broken
        with self.assertRaises(RuntimeError): e.execute(True, 'all')
        self.assertTrue(target.exists())

    def test_symlinks_and_tracked_generated_names_are_never_deleted(self):
        p = self.add('worktrees', 'linked')
        outside = self.root / 'important'; outside.mkdir(); (outside / 'keep').write_text('keep')
        (p / 'node_modules').symlink_to(outside)
        build = self.generated(p, '.next')
        r.git(p, 'add', '-f', '.next/generated'); r.git(p, 'commit', '-qm', 'tracked content')
        self.engine().execute(True, 'worktrees')
        self.assertTrue((outside / 'keep').exists()); self.assertTrue(build.exists())

    def test_completion_requires_production_ancestry(self):
        p = self.add('worktrees', 'unshipped'); target = self.generated(p)
        (p / 'source.txt').write_text('unique');r.git(p, 'add', '.');r.git(p, 'commit', '-qm', 'unique')
        self.engine().execute(True, 'worktrees', complete=p)
        self.assertTrue(p.exists());self.assertTrue(target.exists())

    def test_completion_preserves_dirty_untracked_and_ignored_files(self):
        for name, file in [('dirty','source.txt'), ('untracked','notes.txt'), ('ignored','.env.local')]:
            p = self.add('worktrees', name);self.generated(p)
            (p / file).write_text('keep this')
            self.engine().execute(True, 'worktrees', complete=p)
            self.assertEqual((p / file).read_text(), 'keep this')

    def test_completed_clean_task_removed_branch_preserved(self):
        p = self.root / 'worktrees/finished'
        r.git(self.repo, 'worktree', 'add', '-b', 'finished-task', str(p), 'HEAD')
        self.generated(p)
        self.engine().execute(True, 'worktrees', complete=p)
        self.assertFalse(p.exists())
        self.assertTrue(r.git(self.repo, 'rev-parse', 'refs/heads/finished-task').strip())

    def test_release_counts_and_active_rollback_protection(self):
        for group in ('releases','preview-releases'):
            for i in range(5):
                p=self.add(group,str(i));self.generated(p);self.generated(p,'tmp/macmini-preview-next')
        rollback=self.root/'releases/0'
        # Prior cache cleanup must not promote an old release to newest.
        os.utime(self.root/'preview-releases/0', (self.now, self.now))
        self.engine().execute(True, 'releases', protect=[rollback])
        self.assertTrue(self.production.exists());self.assertTrue(self.preview.exists());self.assertTrue(rollback.exists())
        self.assertEqual(len(list((self.root/'releases').iterdir())),3)
        self.assertEqual(len(list((self.root/'preview-releases').iterdir())),2)
        self.assertFalse((self.root/'preview-releases/0').exists())

    def test_only_exact_next_preview_rewrites_are_disposable(self):
        p=self.add('preview-releases','generated-config')
        (p/'next-env.d.ts').write_text('import "./.next/types/routes.d.ts";\n')
        (p/'tsconfig.json').write_text('{"compilerOptions":{},"include":["source.ts"]}\n')
        r.git(p,'add','.');r.git(p,'commit','-qm','config baseline')
        (p/'next-env.d.ts').write_text('import "./tmp/macmini-preview-next/types/routes.d.ts";\n')
        (p/'tsconfig.json').write_text('{"compilerOptions":{},"include":["source.ts","tmp/macmini-preview-next/dev/types/**/*.ts"]}')
        e=self.engine()
        self.assertEqual(set(e.preview_build_edits(p)),{'next-env.d.ts','tsconfig.json'})
        e.retire(p,[],True,release=True)
        self.assertFalse(p.exists())

    def test_real_preview_config_change_is_preserved(self):
        p=self.add('preview-releases','custom-config')
        (p/'tsconfig.json').write_text('{"compilerOptions":{},"include":["source.ts"]}')
        r.git(p,'add','.');r.git(p,'commit','-qm','config baseline')
        (p/'tsconfig.json').write_text('{"compilerOptions":{"strict":false},"include":["source.ts"]}')
        e=self.engine()
        self.assertIsNone(e.preview_build_edits(p))
        e.retire(p,[],True,release=True)
        self.assertTrue(p.exists())

    def test_locked_and_unregistered_worktrees_preserved(self):
        p=self.add('worktrees','locked');target=self.generated(p)
        r.git(self.repo,'worktree','lock',str(p))
        unknown=self.root/'worktrees/unknown';unknown.mkdir();(unknown/'node_modules').mkdir()
        self.engine().execute(True,'worktrees')
        self.assertTrue(target.exists());self.assertTrue((unknown/'node_modules').exists())

    def test_deployment_lock_cannot_be_stolen(self):
        lock=self.root/'.deploy-lock';lock.mkdir();(lock/'owner').write_text('pid=123\n')
        with self.assertRaises(FileExistsError):
            with r.deployment_lock(self.root): pass
        self.assertEqual((lock/'owner').read_text(),'pid=123\n')
        with self.assertRaises(RuntimeError):
            with r.deployment_lock(self.root,123): pass

    def test_actual_lsof_sees_process_cwd(self):
        sleeper=subprocess.Popen(['/bin/sleep','10'],cwd=self.root)
        try:
            self.assertIn(self.root,r.live_paths())
        finally:
            sleeper.terminate();sleeper.wait()


if __name__ == '__main__':
    unittest.main(verbosity=2)
