#!/usr/bin/env python3
"""Install reviewed, idempotent OpsBot refresh/processor hooks.

Dry run by default. Refuses unknown source anchors before touching either file.
The caller must serialize with the OpsBot refresh lock for live installation.
"""
import argparse
import ast
import os
from pathlib import Path


def replace_once(source, old, new):
    if new in source:
        return source
    if source.count(old) != 1:
        raise ValueError('Unrecognized OpsBot source anchor: ' + old[:100])
    return source.replace(old, new, 1)


def patch_refresh(source):
    source = replace_once(source, 'LOCK_FILE="$LOCK_DIR/opscenter_refresh.lock"',
        'LOCK_FILE="$LOCK_DIR/opscenter_refresh.lock"\n\n'
        'if [ -z "${OPSCENTER_REFRESH_LOCK_FD:-}" ]; then\n'
        '  exec python3 "$WORKDIR/scripts/run-opsbot-refresh-locked.py" "$WORKDIR" "$DATE"\n'
        'fi')
    legacy_lock = '''if ! mkdir "$LOCK_FILE" 2>/dev/null; then
  echo "Another OpsCenter refresh is already running."
  exit 0
fi

cleanup() {
  rmdir "$LOCK_FILE" 2>/dev/null || true
}
trap cleanup EXIT'''
    source = replace_once(source, legacy_lock, '# Refresh lock is owned by the inherited OS-lock launcher.')
    for label in ['LinxUp collection', 'LinxUp live refresh', 'LinxUp location history',
                  'LinxUp alert collection', 'Timesheet-rate collection']:
        source = replace_once(source,
            f'    echo "{label} failed; current refresh will retry before publishing."\n    exit 1',
            f'    echo "{label} failed; publishing validated JunkWare with source freshness retained."')
    return source


def patch_processor(source):
    source = replace_once(source, 'from territory_classification import classify_territory',
        'from territory_classification import classify_territory\nfrom source_aware_metrics import SourcePublication, atomic_json, timestamp\n\nSNAPSHOT_EMPLOYEE_AS_OF = None')
    source = replace_once(source, '        end = datetime.now(TIMEZONE)',
        '        end = timestamp(SNAPSHOT_EMPLOYEE_AS_OF) or start')
    source = replace_once(source, '    payroll_as_of = datetime.now(TIMEZONE).isoformat()',
        '    publication = SourcePublication(WORKDIR, date_iso)\n'
        '    global SNAPSHOT_EMPLOYEE_AS_OF\n'
        '    SNAPSHOT_EMPLOYEE_AS_OF = publication.employee_as_of\n'
        '    payroll_as_of = publication.payroll_as_of')
    source = replace_once(source,
        '    junkware_rows, junkware_path, provisional, provisional_reason = read_junkware_rows(date_iso, missing)',
        '    junkware_rows, junkware_path, provisional, provisional_reason = read_junkware_rows(date_iso, missing)\n'
        '    # A verified empty completed capture is a real zero, never a live-row fallback.\n'
        '    junkware_rows = publication.completed_rows\n'
        '    junkware_path = junkware_completed_path(date_iso)')
    source = replace_once(source,
        '    if date_iso == today_iso() and len(junkware_employee_rows) < 4:\n'
        '        legacy_employee_rows = parse_legacy_employee_rows()\n'
        '        if legacy_employee_rows:\n'
        '            junkware_employee_rows = legacy_employee_rows\n'
        '            junkware_employee_file = WORKDIR / "daily_ops_raw_junkware_today.json"',
        '    # Keep the validated employee capture even on a small-crew day.\n'
        '    # Legacy fallback rows do not share its source timestamp.')
    source = replace_once(source,
        '    output_path.parent.mkdir(parents=True, exist_ok=True)\n    output_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")',
        '    publication.apply(metrics)\n    atomic_json(output_path, metrics)')
    source = replace_once(source,
        '    processed_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")',
        '    atomic_json(processed_path, metrics)')
    source = replace_once(source,
        '        daily_metrics_current_path().write_text(json.dumps(metrics, indent=2), encoding="utf-8")',
        '        atomic_json(daily_metrics_current_path(), metrics)')
    ast.parse(source)
    return source


def install(root, apply=False):
    directory = Path(root) / 'scripts'
    updates = {}
    for name, patch in [('run_opscenter_refresh.sh', patch_refresh), ('process_daily_metrics.py', patch_processor)]:
        path = directory / name
        updates[path] = patch(path.read_text())
    for name in ['source_aware_metrics.py', 'run-opsbot-refresh-locked.py']:
        updates[directory / name] = Path(__file__).with_name(name).read_text()
    # Install helper dependencies before publishing the shell entrypoint.
    updates = dict(sorted(updates.items(), key=lambda item: item[0].name == 'run_opscenter_refresh.sh'))
    for path, text in updates.items():
        if path.exists() and path.read_text() == text:
            print('Already installed: ' + path.name)
            continue
        print(('Installing: ' if apply else 'Would install: ') + path.name)
        if apply:
            temporary = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
            temporary.write_text(text)
            temporary.chmod(path.stat().st_mode & 0o777 if path.exists() else 0o644)
            temporary.replace(path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.home() / '.openclaw/workspace/opsbot')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    install(args.root, args.apply)
