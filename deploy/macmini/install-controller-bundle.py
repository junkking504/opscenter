#!/usr/bin/env python3
"""Stage a complete reviewed controller, then atomically switch one pointer.
Called under the existing installer deployment lock. Never touches spending files.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

CORE = ('workspace-retention.py', 'release-lineage.sh', 'deploy-release.sh', 'deploy-preview-release.sh')
EXTRA = ('release-services.sh', 'origin-state.mjs', 'origin-proxy.mjs', 'release-transaction.mjs',
         'release-bootstrap.mjs', 'verify-release-slots.mjs', 'run-release-slot.sh', 'slot-process.py', 'verify-kernel-isolation.py')
PLISTS = tuple('production-launchd/com.openclaw.opscenter.' + name + '.plist' for name in ('slot-a', 'slot-b', 'origin-proxy'))
FILES = CORE + EXTRA + PLISTS

def directory(p):
    s = p.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or p.resolve() != p:
        raise RuntimeError('Invalid controller directory')

def sync_directory(p):
    fd = os.open(p, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)

def atomic_link(destination, target):
    temp = destination.with_name('.' + destination.name + '.new-' + str(os.getpid()))
    temp.symlink_to(target)
    os.replace(temp, destination)
    fd = os.open(destination.parent, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)

def install(repository, control, sha, validate=True):
    if not re.fullmatch('[a-f0-9]{40}', sha): raise ValueError('Invalid source SHA')
    control.mkdir(mode=0o700, exist_ok=True); directory(control)
    bundles = control / 'bundles'; bundles.mkdir(mode=0o700, exist_ok=True); directory(bundles)
    bundle = bundles / (sha + '-' + str(time.time_ns())); bundle.mkdir(mode=0o700)
    hashes = {}
    for name in FILES:
        content = subprocess.check_output(['git', '-C', str(repository), 'show', sha + ':deploy/macmini/' + name])
        dest = bundle / name; dest.parent.mkdir(mode=0o700, exist_ok=True)
        with dest.open('xb') as f: f.write(content); f.flush(); os.fsync(f.fileno())
        if validate:
            if name.endswith('.sh'): subprocess.run(['/bin/zsh', '-n', str(dest)], check=True)
            elif name.endswith('.mjs'): subprocess.run(['/opt/homebrew/bin/node', '--check', str(dest)], check=True)
            elif name.endswith('.py'): compile(content, name, 'exec')
            elif name.endswith('.plist'): subprocess.run(['/usr/bin/plutil', '-lint', str(dest)], check=True, stdout=subprocess.DEVNULL)
        dest.chmod(0o555 if not name.endswith('.plist') else 0o444)
        hashes[name] = hashlib.sha256(content).hexdigest()
    for child in sorted((p for p in bundle.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True): sync_directory(child)
    sync_directory(bundle); sync_directory(bundles)
    current = control / 'controller-current'
    if current.exists() or current.is_symlink():
        if not current.is_symlink() or current.resolve().parent != bundles: raise RuntimeError('Unexpected current bundle pointer')
        previous = os.readlink(current)
    else:
        baseline = bundles / ('legacy-' + str(time.time_ns())); baseline.mkdir(mode=0o700)
        # Preserve the exact currently installed controller as the bootstrap rollback.
        for name in CORE:
            source = control / name
            s = source.lstat()
            if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_nlink != 1: raise RuntimeError('Unexpected installed controller')
            with (baseline / name).open('xb') as f: f.write(source.read_bytes()); f.flush(); os.fsync(f.fileno())
            (baseline / name).chmod(0o555)
        sync_directory(baseline); sync_directory(bundles)
        previous = str(baseline.relative_to(control)); atomic_link(current, previous)
    # Each public entry remains on the old complete bundle until the final swap.
    for name in CORE + EXTRA:
        destination = control / name
        expected = 'controller-current/' + name
        if destination.is_symlink() and os.readlink(destination) != expected: raise RuntimeError('Unexpected installed alias')
        if destination.exists() and not destination.is_symlink() and name not in CORE: raise RuntimeError('Unmanaged helper exists')
        atomic_link(destination, expected)
    record = dict(version=1, source_commit=sha, previous=previous, current=str(bundle.relative_to(control)), hashes=hashes)
    with (bundle / 'installation.json').open('x') as f: f.write(json.dumps(record, indent=2) + '\n'); f.flush(); os.fsync(f.fileno())
    (bundle / 'installation.json').chmod(0o444)
    sync_directory(bundle)
    # Preserve previous pointer before activation; no collector/app restart here.
    atomic_link(control / 'controller-previous', previous)
    atomic_link(current, record['current'])
    return record

if __name__ == '__main__':
    repo, control, sha = sys.argv[1:]
    print(json.dumps(install(Path(repo), Path(control), sha)))
