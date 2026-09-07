#!/usr/bin/env python3
"""Read one requested schedule day into a separate verified schedule cache."""
import argparse
import importlib.util
import json
import signal
from datetime import date
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', required=True, type=date.fromisoformat)
    parser.add_argument('--opsbot-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('forward_schedule', Path(__file__).with_name('collect-junkware-forward-schedule.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    collector, _paths = helper.load_collector(args.opsbot_dir)
    isolated = helper.isolate_browser_session(collector)
    def terminate(*_):
        raise SystemExit(1)
    signal.signal(signal.SIGTERM, terminate)
    try:
        result = collector.collect_attendance_source(args.date.isoformat())
        verification = result['verification']
        if not verification.get('all_territories_verified'):
            raise RuntimeError('Not all JunkWare markets were verified')
        helper.write_json_atomic(args.output, {
            'date': args.date.isoformat(), 'scraped_at': result['collection_timestamp'],
            'source': 'Requested JunkWare schedule day',
            'appointments': result['appointment_rows'], 'cancelled': result['cancel_rows'],
            'markets_scraped': verification.get('verified_markets', []),
            'territory_verification': verification.get('territories', []),
        })
        print(json.dumps({'ok': True, 'date': args.date.isoformat()}))
    finally:
        collector.close_browser()
        isolated.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
