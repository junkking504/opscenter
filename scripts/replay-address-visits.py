"""Consume address corrections under the existing visit-writer lock.

No network calls, closeouts, expense writes or notification publication.
Each immutable request is acknowledged only after visit validation succeeds.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

def replay(checkout, root, run=subprocess.run):
    directory = root / 'data/addresses/agent/rematch'
    cache_file = root / 'data/cache/appointment_geocodes.json'
    pins = json.loads(cache_file.read_text()).get('addresses', {}) if cache_file.exists() else {}
    groups = {}
    for file in sorted(directory.glob('*.json'))[:100]:
        request = json.loads(file.read_text())
        date = request.get('date', '')
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
            raise ValueError('Invalid address replay date; request retained')
        pin = pins.get(request.get('geocodeKey'), {})
        if not pin.get('house_street_verified') or pin.get('latitude') != request.get('latitude') or pin.get('longitude') != request.get('longitude'):
            continue
        groups.setdefault(date, []).append(file)
    for date, requests in list(groups.items())[:3]:
        if not (root / f'data/history/linxup/linxup_location_{date}.json').exists():
            continue
        for script in (checkout / 'scripts/match-linxup-instant-arrivals.py', root / 'scripts/validate_linxup_appointment_visits.py'):
            run(['python3', str(script), '--date', date], cwd=root, check=True, timeout=30)
        for request in requests:
            request.unlink()
    return len(groups)

if __name__ == '__main__':
    if not os.environ.get('OPSCENTER_LINXUP_LOCK_FD'):
        raise SystemExit('Run address visit replay inside the serialized LinxUp workflow.')
    root = Path(os.environ.get('OPSBOT_DIR') or Path.home() / '.openclaw/workspace/opsbot')
    replay(Path(__file__).resolve().parent.parent, root)
