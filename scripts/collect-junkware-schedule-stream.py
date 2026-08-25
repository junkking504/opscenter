#!/usr/bin/env python3
"""Collect and publish each verified JunkWare market from one browser session.

JunkWare serializes concurrent logins, so the low-latency path deliberately uses
one browser. Each market is published as soon as it is verified instead of
waiting for the other three markets to finish their sweep.
"""

import argparse
import importlib
import os
import subprocess
import sys
from pathlib import Path


MARKETS = [
    ("352", "Junk King New Orleans"),
    ("477", "Junk King Northshore"),
    ("399", "Junk King Baton Rouge"),
    ("484", "Junk King Jefferson Parish"),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--opscenter-dir", required=True)
    args = parser.parse_args()

    opsbot_dir = Path(os.environ.get("OPSBOT_DIR", "/Users/missioncontrol/.openclaw/workspace/opsbot"))
    scripts_dir = opsbot_dir / "scripts"
    data_dir = Path(args.data_dir).resolve()
    opscenter_dir = Path(args.opscenter_dir).resolve()
    if not (scripts_dir / "collect_junkware_daily.py").is_file():
        raise RuntimeError("The authoritative OpsBot JunkWare collector is unavailable.")

    sys.path.insert(0, str(scripts_dir))
    collector = importlib.import_module("collect_junkware_daily")
    original_markets = collector.MARKETS
    original_raw_path = collector.junkware_raw_path
    original_argv = sys.argv
    try:
        for market_id, market_name in MARKETS:
            market_dir = data_dir / "history" / "junkware" / "schedule-watchers" / market_id
            market_dir.mkdir(parents=True, exist_ok=True)
            collector.MARKETS = [(market_id, market_name)]
            collector.junkware_raw_path = lambda _date, directory=market_dir: directory / "market-schedule-raw.json"
            sys.argv = ["collect_junkware_daily.py", "--date", args.date, "--schedule-only"]
            collector.main()

            snapshot = market_dir / f"junkware_schedule_fast_{args.date}.json"
            environment = os.environ.copy()
            environment["OPSCENTER_DATA_DIR"] = str(data_dir)
            subprocess.run(
                [
                    str(opscenter_dir / "node_modules" / ".bin" / "tsx"),
                    "scripts/publish-junkware-schedule-changes.ts",
                    "--data-dir",
                    str(data_dir),
                    "--date",
                    args.date,
                    "--snapshot-file",
                    str(snapshot),
                    "--scope",
                    f"market-{market_id}",
                ],
                cwd=opscenter_dir,
                env=environment,
                check=True,
            )
    finally:
        collector.MARKETS = original_markets
        collector.junkware_raw_path = original_raw_path
        sys.argv = original_argv
        collector.close_browser()


if __name__ == "__main__":
    main()
