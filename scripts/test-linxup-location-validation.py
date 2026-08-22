#!/usr/bin/env python3
"""Verify the deployed OpsBot collector rejects future-dated GPS points."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


sys.dont_write_bytecode = True
opsbot_dir = Path(os.environ.get("OPSBOT_DIR", Path.home() / ".openclaw" / "workspace" / "opsbot"))
scripts_dir = opsbot_dir / "scripts"
collector = scripts_dir / "collect_linxup_location_history.py"
if not collector.is_file():
    raise SystemExit(f"Deployed LinxUp location collector is unavailable: {collector}")

sys.path.insert(0, str(scripts_dir))
from collect_linxup_location_history import validate_points  # noqa: E402
from linxup_common import LinxupError, iso_utc  # noqa: E402


collection_time = datetime.now(timezone.utc)
target_date = collection_time.astimezone(ZoneInfo("America/Chicago")).date()
tracker = "future-validation-test"
point = {
    "timestamp": iso_utc(collection_time + timedelta(seconds=30)),
    "tracker_id": tracker,
    "latitude": 30.0,
    "longitude": -90.0,
}

try:
    validate_points([point], target_date, {tracker}, collection_time)
except LinxupError as exc:
    if str(exc) != "Normalized point has a future timestamp":
        raise SystemExit(f"Future point failed for the wrong reason: {exc}") from exc
else:
    raise SystemExit("Future-dated LinxUp point was not rejected")

print("LinxUp future-point validation check passed.")
