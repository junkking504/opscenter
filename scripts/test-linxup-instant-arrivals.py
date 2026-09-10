#!/usr/bin/env python3
"""Exercise the installed visit matcher with synthetic coordinates only."""
import importlib.util
import os
import sys
from pathlib import Path

root = Path(os.environ.get('OPSBOT_DIR', Path.home() / '.openclaw/workspace/opsbot'))
sys.path.insert(0, str(root / 'scripts'))
import match_linxup_appointment_visits as matcher

spec = importlib.util.spec_from_file_location('instant_arrivals', Path(__file__).with_name('match-linxup-instant-arrivals.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
qualify = policy.instant_qualifier(matcher.qualifying_visits)
point = {'timestamp':'2026-09-10T21:00:00Z','latitude':30.0,'longitude':-90.0}
visits, _, _, pass_by = qualify([point],30,-90,125,0,1,5)
assert len(visits) == 1 and not pass_by
assert visits[0]['arrival'] == point['timestamp']
assert visits[0]['departure'] is None and visits[0]['onsite_minutes'] == 0
assert not qualify([{**point,'latitude':31}],30,-90,125,0,1,5)[0]
assert not qualify([{**point,'timestamp':'2026-09-10T20:00:00Z'}],30,-90,125,0,1,5)[0], 'Do not replay old drive-bys'
old = [{**point,'timestamp':'2026-09-10T20:00:00Z'},{**point,'timestamp':'2026-09-10T20:02:00Z'}]
assert len(qualify(old,30,-90,125,0,1,5)[0]) == 1, 'Preserve earlier qualified history'
print('Installed matcher passed: immediate single-point arrival, zero fabricated duration, outside exclusion, and pre-policy history preservation. Synthetic only.')
