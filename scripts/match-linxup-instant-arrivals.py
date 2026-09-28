#!/usr/bin/env python3
"""Apply the immediate-arrival policy to the installed OpsBot visit matcher."""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

def appointment_day_policy(source: str) -> str:
    """Apply the app-owned presence policy to the installed collector in memory.

    Keep the installed source immutable. Exact anchors fail on incompatible
    collector changes instead of silently returning to booked-time filtering.
    """
    replacements = [
        ('if (stamp := parse_timestamp(point.get("timestamp")))\n                and search_start.astimezone(timezone.utc) <= stamp <= search_end.astimezone(timezone.utc)',
         'if (stamp := parse_timestamp(point.get("timestamp")))\n                and stamp.astimezone(LOCAL_TZ).date() == target\n                and stamp <= datetime.now(timezone.utc)'),
        ('too_long = any(float(visit["onsite_minutes"]) > args.maximum_visit_minutes for visit in visits)',
         'too_long = False  # Presence has no maximum duration.'),
        ('"appointment_search_window_before_minutes": args.before_minutes,',
         '"appointment_search_window_before_minutes": None,\n            "appointment_search_scope": "entire_operating_day",'),
        ('"appointment_search_window_after_minutes": args.after_minutes,',
         '"appointment_search_window_after_minutes": None,'),
        ('"maximum_plausible_visit_duration_minutes": args.maximum_visit_minutes,',
         '"maximum_plausible_visit_duration_minutes": None,'),
        ('args.minimum_dwell_minutes,\n                args.minimum_inside_points,',
         '0,  # One recorded point at the premises establishes a visit.\n                1,'),
        ('"minimum_qualifying_dwell_minutes": args.minimum_dwell_minutes,',
         '"minimum_qualifying_dwell_minutes": 0,'),
        ('"minimum_consecutive_inside_points": args.minimum_inside_points,',
         '"minimum_consecutive_inside_points": 1,'),
    ]
    for old, new in replacements:
        if source.count(old) != 1:
            raise RuntimeError('Installed visit matcher changed; review appointment-day policy anchors')
        source = source.replace(old, new, 1)
    return source


def main():
    root = Path(os.environ.get('OPSBOT_DIR', Path.home() / '.openclaw/workspace/opsbot'))
    sys.path.insert(0, str(root / 'scripts'))
    spec = importlib.util.spec_from_file_location('opsbot_visit_matcher', root / 'scripts/match_linxup_appointment_visits.py')
    module = importlib.util.module_from_spec(spec)
    source = appointment_day_policy(Path(spec.origin).read_text())
    exec(compile(source, spec.origin, "exec"), module.__dict__)
    module.DEFAULT_MIN_DWELL_MINUTES = 0
    module.DEFAULT_MIN_INSIDE_POINTS = 1
    return module.main()


if __name__ == '__main__':
    raise SystemExit(main())
