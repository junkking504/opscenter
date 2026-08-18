#!/usr/bin/env python3
"""Collect one verified JunkWare schedule market without touching the full sweep.

The authoritative collector remains in OpsBot because it owns the protected
browser state and JunkWare credentials. This wrapper deliberately reuses its
schedule parsing and WebForms verification, while constraining one invocation
to a single market and a unique output directory.
"""

import argparse
import importlib
import os
import sys
from pathlib import Path


MARKETS = {
    "352": "Junk King New Orleans",
    "477": "Junk King Northshore",
    "399": "Junk King Baton Rouge",
    "484": "Junk King Jefferson Parish",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True)
    parser.add_argument("--market-id", required=True, choices=sorted(MARKETS))
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    opsbot_dir = Path(os.environ.get("OPSBOT_DIR", "/Users/missioncontrol/.openclaw/workspace/opsbot"))
    scripts_dir = opsbot_dir / "scripts"
    if not (scripts_dir / "collect_junkware_daily.py").is_file():
        raise RuntimeError("The authoritative OpsBot JunkWare collector is unavailable.")

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(scripts_dir))
    collector = importlib.import_module("collect_junkware_daily")

    # The collector's existing all-market success criterion becomes a
    # single-market criterion for this isolated watcher. It still verifies the
    # requested date and selected JunkWare market before it writes anything.
    collector.MARKETS = [(args.market_id, MARKETS[args.market_id])]
    collector.junkware_raw_path = lambda _date: output_dir / "market-schedule-raw.json"
    original_argv = sys.argv
    try:
        sys.argv = ["collect_junkware_daily.py", "--date", args.date, "--schedule-only"]
        collector.main()
    finally:
        sys.argv = original_argv
        collector.close_browser()


if __name__ == "__main__":
    main()
