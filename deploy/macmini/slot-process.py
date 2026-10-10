#!/usr/bin/env python3
"""Owned advisory slot lock held across exec; never reclaim another process."""
import fcntl
import os
from pathlib import Path
import re
import socket
import stat
import sys


def main():
    slot, release_arg, port_arg = sys.argv[1:]
    if slot not in ('a', 'b') or port_arg != {'a': '3201', 'b': '3202'}[slot]:
        raise ValueError('Invalid slot identity')
    root = Path('/Users/missioncontrol/opscenter-v2')
    release = Path(release_arg)
    if not re.fullmatch('[a-f0-9]{40}', release.name) or release.parent != root / 'releases' or release.resolve() != release:
        raise ValueError('Invalid immutable release')
    directory = root / '.release-slots'
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or directory.resolve() != directory or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Invalid state directory')
    fd = os.open(str(directory / ('slot-' + slot + '.lock')), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
        raise ValueError('Invalid slot lock')
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.ftruncate(fd, 0)
    os.write(fd, ('pid=%s\nsha=%s\n' % (os.getpid(), release.name)).encode())
    os.fsync(fd)
    os.set_inheritable(fd, True)
    # Probe only: the real bind still decides. A race fails startup, never kills.
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(('127.0.0.1', int(port_arg)))
    os.chdir(str(release))
    env = dict(os.environ, NODE_ENV='production', HOSTNAME='127.0.0.1', PORT=port_arg,
               OPSCENTER_RUNTIME='MISSION_CONTROL', OPSCENTER_APP_DIR=str(release))
    os.execve('/opt/homebrew/bin/node', ['node', str(release / 'node_modules/next/dist/bin/next'),
              'start', '-H', '127.0.0.1', '-p', port_arg], env)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Pinned slot startup rejected: identity, ownership, lock or listener unavailable.', file=sys.stderr)
        raise SystemExit(75)
