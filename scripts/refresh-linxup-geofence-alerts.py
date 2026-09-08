#!/usr/bin/env python3
"""Bound the existing read-only alert collector inside the minute GPS refresh."""
from __future__ import annotations

import subprocess
import sys
from datetime import date
from pathlib import Path


def refresh(target: str, root: Path, run=subprocess.run) -> bool:
    if date.fromisoformat(target).isoformat() != target:
        raise ValueError("Invalid operating date")
    try:
        result = run(
            [sys.executable, str(root / "scripts" / "collect_linxup_alerts.py"), "--date", target],
            cwd=root,
            timeout=20,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        print("LinxUp geofence alert refresh unavailable; retaining collected history and retrying next cycle.")
        return False
    if result.returncode:
        print("LinxUp geofence alert refresh failed; retrying next cycle.")
        return False
    return True


if __name__ == "__main__":
    # Failure is independent of position collection and must not stop live GPS.
    refresh(sys.argv[1], Path(sys.argv[2]))
