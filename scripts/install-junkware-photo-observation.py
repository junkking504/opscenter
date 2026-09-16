#!/usr/bin/env python3
"""Install reviewed per-gallery observation timestamps; never collect or restart."""
import argparse
import hashlib
import os
import shutil
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path

BASELINE_SHA256 = '07175826cc56945a5e98a08eb36dc7f95ee784159bba222a4078b6495b8e5ca5'
INSTALLED_SHA256 = 'ffd716ee256cb44729b86dbb51810ed1c101394d0331b2bfc9b016e1df125974'
SOURCE_NAME = 'collect_junkware_daily.py'
REPLACEMENTS = (
    ('        try:\n            run_browser(["navigate", url])\n',
     '        try:\n            # Server-rendered photos belong to this request, not the end of the full collection.\n            photo_observed_at = datetime.now(TIMEZONE).isoformat()\n            run_browser(["navigate", url])\n'),
    ('                "photos": normalize_job_photos(data.get("photos", [])),\n',
     '                "photos": normalize_job_photos(data.get("photos", [])),\n                "photo_observed_at": photo_observed_at,\n'),
    ('        if "photos" in details:\n            row["photos"] = list(details.get("photos", []) or [])\n',
     '        if "photos" in details:\n            row["photos"] = list(details.get("photos", []) or [])\n            row["photo_observed_at"] = details["photo_observed_at"]\n'),
)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def patched_source(old):
    source = old.decode('utf-8')
    for before, after in REPLACEMENTS:
        if source.count(before) != 1:
            raise RuntimeError('Collector patch anchor changed; review source before installing')
        source = source.replace(before, after, 1)
    result = source.encode('utf-8')
    compile(result, SOURCE_NAME, 'exec')
    return result


def reviewed_source(old):
    checksum = digest(old)
    if checksum == INSTALLED_SHA256:
        return old
    if checksum != BASELINE_SHA256:
        raise RuntimeError('Unreviewed collector drift; inspect and reconcile before installing')
    new = patched_source(old)
    if digest(new) != INSTALLED_SHA256:
        raise RuntimeError('Reviewed collector patch hash mismatch')
    return new


def install(root, apply=False):
    destination = root / 'scripts' / SOURCE_NAME
    mode = destination.lstat().st_mode
    if not stat.S_ISREG(mode):
        raise RuntimeError('Collector destination must be a regular file')
    old = destination.read_bytes()
    new = reviewed_source(old)
    if old == new:
        print('JunkWare photo observation timestamps already match the reviewed version')
        return False
    if not apply:
        print('Would install JunkWare per-gallery observation timestamps')
        return True
    backup = root / 'backups' / ('junkware-photo-observation-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(destination, backup / SOURCE_NAME)
    staged = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as handle:
            staged = Path(handle.name)
            handle.write(new)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(staged, stat.S_IMODE(mode))
        if not stat.S_ISREG(destination.lstat().st_mode) or destination.read_bytes() != old:
            raise RuntimeError('Collector changed during install; no replacement made')
        os.replace(staged, destination)
    finally:
        if staged is not None and staged.exists():
            staged.unlink()
    print(f'Backup: {backup}')
    print('Installed JunkWare per-gallery observation timestamps for future collections')
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.home() / '.openclaw/workspace/opsbot')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    install(args.root, args.apply)
