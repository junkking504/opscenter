#!/usr/bin/env python3
"""PostgreSQL stderr only. Dry-run by default; never walks or prunes runtime data."""
import argparse
import datetime
import fcntl
import gzip
import json
import os
from pathlib import Path
import stat
import sys

LOG = 'postgres-production.err.log'
THRESHOLD = 32 * 1024 * 1024
KEEP = 3
FLAGS = os.O_NOFOLLOW | os.O_CLOEXEC


def directory_fd(path):
    path = Path(path).absolute()
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parts[1:]:
            new = os.open(component, os.O_RDONLY | os.O_DIRECTORY | FLAGS, dir_fd=fd)
            os.close(fd)
            fd = new
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise RuntimeError('log directory must be owned by this user and not group/world writable')
        return fd
    except BaseException:
        os.close(fd)
        raise


def regular(fd, name):
    try:
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
        raise RuntimeError('unsafe file: ' + name)
    return info


def receipt(fd, value):
    name = '.postgres-log-rotation-status.tmp'
    # O_EXCL leaves uncertain previous writes for review instead of overwriting.
    output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS, 0o600, dir_fd=fd)
    with os.fdopen(output, 'w') as f:
        json.dump(value, f, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
    regular(fd, 'postgres-log-rotation-status.json')
    os.replace(name, 'postgres-log-rotation-status.json', src_dir_fd=fd, dst_dir_fd=fd)
    os.fsync(fd)


def rotate(directory, apply=False, threshold=THRESHOLD):
    """threshold override is for isolated fixtures; the CLI policy is fixed."""
    fd = directory_fd(directory)
    lock = log = None
    result = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'log': LOG, 'apply': apply, 'thresholdBytes': threshold, 'archiveCount': KEEP}
    pending = LOG + '.rotation-pending.gz'
    try:
        regular(fd, '.postgres-log-rotation.lock')
        lock = os.open('.postgres-log-rotation.lock', os.O_RDWR | os.O_CREAT | FLAGS, 0o600, dir_fd=fd)
        if os.fstat(lock).st_nlink != 1:
            raise RuntimeError('unsafe lock')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return dict(result, status='busy')
        # Validate every touched path before doing anything to the log.
        info = regular(fd, LOG)
        regular(fd, 'postgres-log-rotation-status.json')
        for i in range(1, KEEP + 1): regular(fd, f'{LOG}.{i}.gz')
        if regular(fd, pending) is not None:
            raise RuntimeError('pending archive requires review; no further rotation')
        if info is None:
            result.update(status='missing')
        elif info.st_size < threshold:
            result.update(status='below_threshold', bytes=info.st_size)
        elif not apply:
            result.update(status='would_rotate', bytes=info.st_size,
                          wouldExpire=f'{LOG}.{KEEP}.gz' if regular(fd, f'{LOG}.{KEEP}.gz') else None)
        else:
            log = os.open(LOG, os.O_RDWR | FLAGS, dir_fd=fd)
            opened = os.fstat(log)
            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                raise RuntimeError('log changed during open')
            archive = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | FLAGS, 0o600, dir_fd=fd)
            # Snapshot an exact byte count. Any incomplete copy leaves the live file
            # intact and the pending archive for investigation. Never truncate on error.
            with os.fdopen(archive, 'wb') as output:
                with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as compressed:
                    remaining = opened.st_size
                    while remaining:
                        data = os.read(log, min(1024 * 1024, remaining))
                        if not data: raise RuntimeError('log shrank while copying')
                        compressed.write(data); remaining -= len(data)
                output.flush(); os.fsync(output.fileno())
            os.fsync(fd)
            current = regular(fd, LOG)
            if current is None or (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
                raise RuntimeError('log replaced while copying; archive retained, no truncation')
            if os.fstat(log).st_size != opened.st_size:
                raise RuntimeError('log grew while copying; archive retained, no truncation')
            # Writer inode/descriptor is retained. A write between the last stat and
            # truncate can still be lost: the documented copy/truncate limitation.
            os.ftruncate(log, 0); os.fsync(log)
            for i in range(KEEP - 1, 0, -1):
                old = f'{LOG}.{i}.gz'
                if regular(fd, old):
                    os.replace(old, f'{LOG}.{i + 1}.gz', src_dir_fd=fd, dst_dir_fd=fd)
            os.replace(pending, f'{LOG}.1.gz', src_dir_fd=fd, dst_dir_fd=fd)
            os.fsync(fd)
            result.update(status='rotated', archivedBytes=opened.st_size)
        if apply: receipt(fd, result)
        return result
    except Exception as error:
        result.update(status='failed', error=str(error))
        if apply:
            try: receipt(fd, result)
            except Exception as receipt_error: result['receiptError'] = str(receipt_error)
        print(json.dumps(result), file=sys.stderr)
        raise
    finally:
        if log is not None: os.close(log)
        if lock is not None: os.close(lock)
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    directory = Path.home() / 'Library/Logs/OpsCenter'
    try: result = rotate(directory, args.apply)
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
