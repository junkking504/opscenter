#!/usr/bin/env python3
"""Retire the OpsBot paid geocoder fallback without changing source records.

Idempotent migration for the separately owned local collector source. The old
function name remains for existing imports, but it can no longer make requests.
"""
import ast
from pathlib import Path
import argparse


def retire(source):
    tree = ast.parse(source)
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'geocode_google')
    lines = source.splitlines(keepends=True)
    lines[function.lineno - 1:function.end_lineno] = ['''def geocode_google(address: str, fallback_reason: str) -> dict[str, Any]:
    """Retired paid provider. Kept only for older collector callers."""
    return {
        "latitude": None, "longitude": None, "geocoder_source": "Unavailable",
        "match_confidence": "ambiguous", "normalized_address": address,
        "collection_timestamp": collected_at(), "reason": f"paid_geocoding_disabled;{fallback_reason}",
    }
''']
    return ''.join(line for line in lines if not line.startswith('GOOGLE_GEOCODING_URL ='))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default=str(Path.home()/'.openclaw/workspace/opsbot'))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    geocoder = Path(args.root)/'scripts/geocode_junkware_appointments.py'
    source = geocoder.read_text()
    updated = retire(source)
    compile(updated, str(geocoder), 'exec')
    runner = Path(args.root)/'scripts/run_junkware_collect_today.sh'
    old_runner = runner.read_text()
    start = old_runner.find("# The geocoder's Google fallback")
    end = old_runner.find('DATE_ARG=', start) if start >= 0 else -1
    new_runner = old_runner[:start]+old_runner[end:] if start >= 0 and end > start else old_runner
    for file, old, new in [(geocoder, source, updated), (runner, old_runner, new_runner)]:
        if old != new:
            if args.apply:
                file.write_text(new)
            print(('Updated ' if args.apply else 'Would update ')+file.name)
        else:
            print('Already disabled: '+file.name)


if __name__ == '__main__':
    main()
