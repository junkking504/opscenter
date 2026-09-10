#!/usr/bin/env python3
"""Apply the immediate-arrival policy to the installed OpsBot visit matcher."""
from __future__ import annotations

import importlib.util
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Preserve pre-change history instead of replaying earlier drive-bys as new alerts.
POLICY_START = datetime(2026, 9, 10, 20, 33, tzinfo=timezone.utc)


def instant_qualifier(original):
    def qualify(points, lat, lon, radius, min_dwell, min_points, grace):
        visits, distance, gaps, pass_by = original(points, lat, lon, radius, min_dwell, min_points, grace)
        if min_dwell == 0 and min_points == 1:
            visits = [visit for visit in visits if
                      datetime.fromisoformat(visit['arrival'].replace('Z', '+00:00')) >= POLICY_START
                      or (visit['inside_point_count'] >= 2 and visit['onsite_minutes'] >= 2)]
            pass_by = not visits and distance is not None and distance <= radius
        return visits, distance, gaps, pass_by
    return qualify


def main():
    root = Path(os.environ.get('OPSBOT_DIR', Path.home() / '.openclaw/workspace/opsbot'))
    sys.path.insert(0, str(root / 'scripts'))
    spec = importlib.util.spec_from_file_location('opsbot_visit_matcher', root / 'scripts/match_linxup_appointment_visits.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.DEFAULT_MIN_DWELL_MINUTES = 0
    module.DEFAULT_MIN_INSIDE_POINTS = 1
    module.DEFAULT_BEFORE_MINUTES = 240
    module.qualifying_visits = instant_qualifier(module.qualifying_visits)
    return module.main()


if __name__ == '__main__':
    raise SystemExit(main())
