#!/usr/bin/env python3
"""Bounded OpsCenter storage lifecycle. Read-only unless --apply is explicit."""
import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

HOST_ROOT = Path('/Users/missioncontrol/opscenter-v2')
DAY = 86400
POLICY = {'production': 3, 'preview': 2, 'inactive_days': 7, 'budget_gb': 30}


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True,
                          timeout=kwargs.pop('timeout', 30), **kwargs)


def git(path, *args):
    result = run('git', '-C', path, *args)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Git query failed')
    return result.stdout


def inside(path, parent):
    return path == parent or parent in path.parents


def live_paths():
    result = run('/usr/sbin/lsof', '-nP', '-Fn', timeout=15)
    # Global lsof includes cwd, executable, memory mappings and open files. Do
    # not run +D on millions of dependencies; timeout/permission errors fail shut.
    if result.returncode != 0 or result.stderr.strip():
        raise RuntimeError('Process-reference scan incomplete; no cleanup is safe')
    return [Path(line[1:]) for line in result.stdout.splitlines()
            if line.startswith('n/')]


class Retention:
    def __init__(self, root, process_scan=live_paths, now=None):
        self.root = Path(root)
        self.repo = self.root / 'repository'
        self.scan = process_scan
        self.now = now or time.time()
        self.events = []
        self.protected = set()
        self.active = None
        self.registry = {}
        for block in git(self.repo, 'worktree', 'list', '--porcelain').split('\n\n'):
            fields = dict(line.split(' ', 1) if ' ' in line else (line, '')
                          for line in block.splitlines())
            if 'worktree' in fields:
                self.registry[Path(fields['worktree'])] = fields
        for name in ('opscenter', 'opscenter-preview'):
            link = self.root / name
            if not link.is_symlink() or not link.resolve().is_dir():
                raise RuntimeError('Active release link unavailable: ' + str(link))
            self.protected.add(link.resolve())
        self.active = git(self.root / 'opscenter', 'rev-parse', 'HEAD').strip()

    def event(self, path, action, reason):
        self.events.append({'path': str(path), 'action': action, 'reason': reason})

    def identity(self, path):
        if path.is_symlink() or not path.is_dir() or path.resolve() != path:
            return 'missing, aliased or symbolic-link worktree'
        info = self.registry.get(path)
        if not info or 'locked' in info or 'prunable' in info:
            return 'unregistered, locked or uncertain worktree'
        common = Path(git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir').strip())
        if common.resolve() != (self.repo / '.git').resolve():
            return 'different Git repository'
        return None

    def busy(self, path, paths):
        if path in self.protected:
            return 'active release or retained rollback'
        if any(inside(p, path) for p in paths):
            return 'referenced by a running process'
        return self.identity(path)

    def generated(self, path):
        candidates = []
        for parent in (path, path / 'desktop-ui', path / 'prototype'):
            if parent.is_symlink() or not (parent / 'package.json').is_file():
                continue
            candidates.extend(p for p in parent.iterdir() if p.name == 'node_modules'
                              or p.name == '.next' or p.name.startswith('.next-'))
        candidates.append(path / 'tmp/macmini-preview-next')
        valid = []
        for target in candidates:
            if not target.is_dir() or target.is_symlink() or target.resolve() != target:
                continue
            relative = str(target.relative_to(path))
            if git(path, 'ls-files', '--', relative):
                continue
            if run('git', '-C', path, 'check-ignore', '-q', relative).returncode:
                continue
            valid.append(target)
        return valid

    def last_activity(self, path, generated):
        latest = path.stat().st_mtime
        gitdir = Path(git(path, 'rev-parse', '--absolute-git-dir').strip())
        for p in (gitdir / 'index', gitdir / 'logs/HEAD'):
            if p.exists():
                latest = max(latest, p.stat().st_mtime)
        # Walk source and local files, never runtime symlinks or dependency trees.
        for directory, dirs, files in os.walk(path, followlinks=False):
            parent = Path(directory)
            latest = max(latest, parent.stat().st_mtime)
            for name in list(dirs):
                p = parent / name
                if p.is_symlink() or p in generated or name == '.git':
                    dirs.remove(name)
                    if not p.is_symlink():
                        latest = max(latest, p.stat().st_mtime)
            for name in files:
                p = parent / name
                if not p.is_symlink():
                    latest = max(latest, p.stat().st_mtime)
        return latest

    def remove_generated(self, path, targets, apply):
        for target in targets:
            if apply:
                reason = self.busy(path, self.scan())
                if reason:
                    self.event(path, 'keep', reason)
                    return False
                # Repeat path/ignore/tracked checks immediately before deletion.
                if target not in self.generated(path):
                    raise RuntimeError('Generated target changed: ' + str(target))
                shutil.rmtree(target)
            self.event(target, 'remove-generated' if apply else 'would-remove-generated',
                       'ignored dependencies or compiled build; source retained')
        return True

    def extra_files(self, path, generated, release):
        others = git(path, 'ls-files', '--others', '--exclude-standard', '-z')
        ignored = git(path, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z')
        extras = [s for s in (others + ignored).split('\0') if s]
        for relative in extras:
            target = path / relative
            if any(inside(target, p) for p in generated):
                continue
            if release and relative == '.opscenter-release' and target.is_file() and not target.is_symlink():
                continue
            if release and relative in ('data', 'logs', '.env.slack.local') and target.is_symlink():
                expected = {'data': Path('/Users/missioncontrol/.openclaw/workspace/opsbot/data'),
                            'logs': Path('/Users/missioncontrol/Library/Logs/OpsCenter'),
                            '.env.slack.local': Path('/Users/missioncontrol/Library/Application Support/OpsCenter/slack.env')}
                if target.resolve() == expected[relative].resolve():
                    continue
            return relative
        return None

    def preview_build_edits(self, path):
        """Only Next's known preview dist-path rewrite is disposable source."""
        if path.parent != self.root / 'preview-releases' or git(path, 'diff', '--cached', '--name-only'):
            return None
        changed = git(path, 'diff', '--name-only').splitlines()
        for name in changed:
            if name not in ('next-env.d.ts', 'tsconfig.json') or (path / name).is_symlink():
                return None
            original = git(path, 'show', 'HEAD:' + name)
            current = (path / name).read_text()
            if name == 'next-env.d.ts':
                if current != original.replace('./.next/', './tmp/macmini-preview-next/'):
                    return None
            else:
                try:
                    expected, actual = json.loads(original), json.loads(current)
                    if not isinstance(expected, dict) or not isinstance(actual, dict):
                        return None
                    allowed = {'tmp/macmini-preview-next/types/**/*.ts',
                               'tmp/macmini-preview-next/dev/types/**/*.ts'}
                    before, after = expected.get('include', []), actual.get('include', [])
                    if [x for x in after if x not in allowed - set(before)] != before:
                        return None
                    actual['include'] = before
                    if expected != actual:
                        return None
                except (ValueError, TypeError):
                    return None
        return changed

    def retire(self, path, generated, apply, release=False):
        dirty = git(path, 'status', '--porcelain', '--untracked-files=no').strip()
        build_edits = self.preview_build_edits(path) if dirty and release else []
        if dirty and (not release or build_edits is None):
            self.event(path, 'keep', 'tracked files have local changes')
            return
        extra = self.extra_files(path, generated, release)
        if extra:
            self.event(path, 'keep', 'unrecognized local or ignored file: ' + extra)
            return
        if apply:
            reason = self.busy(path, self.scan())
            if reason:
                self.event(path, 'keep', reason)
                return
            if build_edits:
                if self.preview_build_edits(path) != build_edits:
                    raise RuntimeError('Preview source changed during cleanup')
                git(path, 'restore', '--source=HEAD', '--worktree', '--', *build_edits)
            # git checks tracked and untracked files again. Expected release-only
            # metadata/symlinks can be removed explicitly without following them.
            if release:
                for name in ('.opscenter-release', 'data', 'logs', '.env.slack.local'):
                    p = path / name
                    if p.is_symlink() or (name == '.opscenter-release' and p.is_file()):
                        p.unlink()
            git(self.repo, 'worktree', 'remove', str(path))  # never --force / prune
        self.event(path, 'remove-worktree' if apply else 'would-remove-worktree',
                   'superseded release' if release else 'clean task already contained in production')

    def release_group(self, group, keep, apply, paths, extra_protected):
        parent = self.root / group
        def release_time(path):
            # Removing a cache changes directory mtime. It must not make an
            # August release look newly deployed or consume a rollback slot.
            stat = path.stat()
            created = getattr(stat, 'st_birthtime', stat.st_mtime)
            marker = path / '.opscenter-release'
            if marker.is_file() and not marker.is_symlink():
                created = max(created, marker.stat().st_mtime)
            return created
        releases = sorted((p for p in parent.iterdir() if p.is_dir() and not p.is_symlink()),
                          key=release_time, reverse=True)
        selected = [p for p in releases if p in self.protected or p in extra_protected]
        for p in releases:
            if len(selected) >= keep:
                break
            if p not in selected:
                selected.append(p)
        self.protected.update(selected)
        for path in releases:
            reason = self.busy(path, paths)
            if reason:
                self.event(path, 'keep', reason)
                continue
            if self.now - release_time(path) < DAY:
                self.event(path, 'keep', 'release created or deployed within 24 hours')
                continue
            generated = self.generated(path)
            if self.remove_generated(path, generated, apply):
                self.retire(path, [] if apply else generated, apply, release=True)

    def execute(self, apply=False, scope='all', complete=None, protect=()):
        paths = self.scan()  # a failed scan blocks the entire run
        extra_protected = {Path(p).resolve() for p in protect}
        self.protected.update(extra_protected)
        if scope in ('all', 'releases', 'production'):
            self.release_group('releases', POLICY['production'], apply, paths, extra_protected)
        if scope in ('all', 'releases', 'preview'):
            self.release_group('preview-releases', POLICY['preview'], apply, paths, extra_protected)
        if scope in ('all', 'worktrees'):
            candidates = [Path(complete)] if complete else sorted((self.root / 'worktrees').iterdir())
            for path in candidates:
                if path.parent != self.root / 'worktrees':
                    raise RuntimeError('Task must be directly inside worktrees/')
                reason = self.busy(path, paths)
                if reason:
                    self.event(path, 'keep', reason)
                    continue
                generated = self.generated(path)
                if complete:
                    head = git(path, 'rev-parse', 'HEAD').strip()
                    if run('git', '-C', self.repo, 'merge-base', '--is-ancestor', head, self.active).returncode:
                        self.event(path, 'keep', 'task commits are not contained in active production')
                        continue
                elif self.now - self.last_activity(path, generated) < POLICY['inactive_days'] * DAY:
                    self.event(path, 'keep', 'task changed within seven days')
                    continue
                if self.remove_generated(path, generated, apply) and complete:
                    self.retire(path, [] if apply else generated, apply)
        return self.events


@contextlib.contextmanager
def deployment_lock(root, owner=None):
    lock = root / '.deploy-lock'
    if owner:
        if owner != os.getppid() or not (lock / 'owner').is_file():
            raise RuntimeError('Invalid deployment lock handoff')
        if 'pid=' + str(owner) not in (lock / 'owner').read_text().splitlines():
            raise RuntimeError('Deployment lock owner changed')
        yield
        return
    lock.mkdir()  # never steal or remove an existing deployment lock
    try:
        (lock / 'owner').write_text('pid=' + str(os.getpid()) + '\nworkspace-retention\n')
        yield
    finally:
        (lock / 'owner').unlink(missing_ok=True)
        lock.rmdir()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--scope', choices=('all', 'releases', 'production', 'preview', 'worktrees'), default='all')
    parser.add_argument('--complete', type=Path, help='explicitly retire this shipped task; run from outside it')
    parser.add_argument('--protect', action='append', default=[], type=Path)
    parser.add_argument('--deployment-owner', type=int)
    parser.add_argument('--measure', action='store_true', help='measure full workspace against 30 GB budget')
    args = parser.parse_args()
    if HOST_ROOT.resolve() != HOST_ROOT or not (HOST_ROOT / 'repository/.git').is_dir():
        raise RuntimeError('Real Mission Control host paths must resolve')
    if args.complete and args.scope not in ('all', 'worktrees'):
        parser.error('--complete requires worktrees or all scope')
    state = Path('/Users/missioncontrol/Library/Application Support/OpsCenter/workspace-retention')
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'run.lock').open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        context = deployment_lock(HOST_ROOT, args.deployment_owner) if args.apply else contextlib.nullcontext()
        engine = None
        failure = None
        try:
            with context:
                engine = Retention(HOST_ROOT)
                engine.execute(args.apply, args.scope, args.complete, args.protect)
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
            failure = error
        report = {'checked_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  'applied': args.apply, 'policy': POLICY, 'events': engine.events if engine else [],
                  'free_gb': round(shutil.disk_usage(HOST_ROOT).free / 1e9, 1)}
        if args.measure and not failure:
            try:
                size = run('du', '-sk', HOST_ROOT, timeout=300)
                if size.returncode:
                    raise RuntimeError('Workspace size measurement incomplete')
                report['workspace_gb'] = round(int(size.stdout.split()[0]) * 1024 / 1e9, 1)
                report['over_budget'] = report['workspace_gb'] > POLICY['budget_gb']
            except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
                failure = error
        if failure:
            report['error'] = str(failure)
        output = state / ('last-applied.json' if args.apply else 'last-check.json')
        temporary = output.with_suffix('.tmp')
        temporary.write_text(json.dumps(report, indent=2) + '\n')
        temporary.replace(output)
        print(json.dumps({k: v for k, v in report.items() if k != 'events'}))
        events = report['events']
        counts = {action: sum(e['action'] == action for e in events) for action in sorted({e['action'] for e in events})}
        print(json.dumps(counts))
        print('Details: ' + str(output))
        if failure:
            raise failure


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print('Workspace cleanup stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
