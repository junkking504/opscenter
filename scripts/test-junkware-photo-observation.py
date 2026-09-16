#!/usr/bin/env python3
"""Mocked collector timing and installer checks; no provider or runtime writes."""
import argparse
import contextlib
import importlib.util
import io
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('photo_observation_installer', Path(__file__).with_name('install-junkware-photo-observation.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

FIXTURE = b'''def collect_appointment_details(rows):
    result = {}
    for row in rows:
        url = row["id"]
        try:
            run_browser(["navigate", url])
            data = evaluate()
            result[url] = {
                "photos": normalize_job_photos(data.get("photos", [])),
            }
        except Exception:
            result[url] = {"collection_error": "failed"}
    return result

def collect(rows):
    detail_map = collect_appointment_details(rows)
    collection_timestamp = datetime.now(TIMEZONE).isoformat()
    for row in rows:
        details = detail_map[row["id"]]
        if "photos" in details:
            row["photos"] = list(details.get("photos", []) or [])
        row["collection_timestamp"] = collection_timestamp
    return rows
'''


def raises(function, match):
    try:
        function()
    except RuntimeError as error:
        assert match in str(error), str(error)
    else:
        raise AssertionError('Expected rejection: ' + match)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Optional read-only check of the actual reviewed collector source')
    args = parser.parse_args()
    if args.source:
        original = args.source.read_bytes()
        assert installer.digest(installer.reviewed_source(original)) == installer.INSTALLED_SHA256
    updated = installer.patched_source(FIXTURE)
    events = []
    class Clock:
        @staticmethod
        def now(_zone):
            events.append('clock')
            value = f'2026-09-16T20:45:{len(events):02d}Z'
            class Stamp:
                def isoformat(self): return value
            return Stamp()
    def navigate(command):
        assert events[-1] == 'clock', 'Timestamp must be captured immediately before acquisition begins'
        events.append('navigate:' + command[1])
        if command[1] == 'failed': raise RuntimeError('source unavailable')
    scope = dict(datetime=Clock, TIMEZONE=None, run_browser=navigate, evaluate=lambda: {'photos': ['source-image']}, normalize_job_photos=lambda value: value)
    exec(compile(updated, 'synthetic-collector.py', 'exec'), scope)
    rows = scope['collect']([{'id': 'first'}, {'id': 'second'}, {'id': 'failed'}])
    assert rows[0]['photo_observed_at'] < rows[1]['photo_observed_at'] < rows[0]['collection_timestamp']
    assert rows[0]['collection_timestamp'] == rows[1]['collection_timestamp'], 'Whole-collection time remains unchanged'
    assert rows[0]['photos'] == ['source-image']
    assert 'photos' not in rows[2] and 'photo_observed_at' not in rows[2], 'Failed acquisition cannot fabricate a photo observation'
    # An observed empty gallery is meaningful and must retain its timestamp.
    scope['evaluate'] = lambda: {'photos': []}
    empty = scope['collect']([{'id': 'empty'}])[0]
    assert empty['photos'] == [] and empty['photo_observed_at']
    raises(lambda: installer.patched_source(FIXTURE + FIXTURE), 'anchor changed')
    with tempfile.TemporaryDirectory(prefix='photo-observation-installer-') as directory:
        root = Path(directory)
        destination = root / 'scripts' / installer.SOURCE_NAME
        destination.parent.mkdir()
        destination.write_bytes(FIXTURE)
        destination.chmod(0o640)
        with patch.object(installer, 'BASELINE_SHA256', installer.digest(FIXTURE)), patch.object(installer, 'INSTALLED_SHA256', installer.digest(updated)), contextlib.redirect_stdout(io.StringIO()):
            assert installer.install(root) is True
            assert destination.read_bytes() == FIXTURE and not (root / 'backups').exists(), 'Default dry run never mutates source or backup directories'
            assert installer.install(root, apply=True) is True
            assert destination.read_bytes() == updated and destination.stat().st_mode & 0o777 == 0o640
            backups = list((root / 'backups').glob('*/' + installer.SOURCE_NAME))
            assert len(backups) == 1 and backups[0].read_bytes() == FIXTURE
            assert installer.install(root, apply=True) is False
            assert len(list((root / 'backups').glob('*'))) == 1, 'Idempotent rerun creates no backups'
            destination.write_bytes(updated + b'\n# drift\n')
            raises(lambda: installer.install(root, apply=True), 'Unreviewed collector drift')
            assert destination.read_bytes().endswith(b'# drift\n')
            destination.write_bytes(FIXTURE)
            with patch.object(installer, 'INSTALLED_SHA256', '0' * 64):
                raises(lambda: installer.install(root, apply=True), 'patch hash mismatch')
            destination.unlink()
            os.symlink(backups[0], destination)
            raises(lambda: installer.install(root, apply=True), 'regular file')
            destination.unlink()
            destination.write_bytes(FIXTURE)
            real_copy = installer.shutil.copy2
            def concurrent_edit(source, target):
                result = real_copy(source, target)
                source.write_bytes(FIXTURE + b'\n# concurrent edit\n')
                return result
            with patch.object(installer.shutil, 'copy2', concurrent_edit):
                raises(lambda: installer.install(root, apply=True), 'changed during install')
            assert destination.read_bytes().endswith(b'# concurrent edit\n'), 'Concurrent source changes are preserved'
            assert sorted(item.name for item in destination.parent.iterdir()) == [installer.SOURCE_NAME], 'Temporary replacement is removed after failure'
    print('PASS: acquisition-start timestamps, per-gallery propagation, failed/empty observations, exact hashes, drift rejection, dry run, backup, atomic replacement, idempotence and concurrency protection')


if __name__ == '__main__':
    main()
