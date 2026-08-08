#!/usr/bin/env python3
"""Run the forward JunkWare schedule collector in isolated parallel chunks."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date, timedelta
from pathlib import Path


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid date: {value}") from exc


def split_range(start: date, end: date, count: int) -> list[tuple[date, date]]:
    total_days = (end - start).days + 1
    count = max(1, min(count, total_days))
    base, extra = divmod(total_days, count)
    chunks: list[tuple[date, date]] = []
    cursor = start
    for index in range(count):
        size = base + (1 if index < extra else 0)
        chunk_end = cursor + timedelta(days=size - 1)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks


def split_dates(values: list[date], count: int) -> list[list[date]]:
    count = max(1, min(count, len(values)))
    base, extra = divmod(len(values), count)
    chunks: list[list[date]] = []
    cursor = 0
    for index in range(count):
        size = base + (1 if index < extra else 0)
        chunks.append(values[cursor:cursor + size])
        cursor += size
    return chunks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-date", type=parse_date)
    parser.add_argument("--through-date", type=parse_date)
    parser.add_argument(
        "--retry-report",
        type=Path,
        help="Retry only dates with errors in this prior batch report.",
    )
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument(
        "--opsbot-dir",
        type=Path,
        default=Path.home() / ".openclaw" / "workspace" / "opsbot",
    )
    args = parser.parse_args()
    if args.workers < 1:
        parser.error("--workers must be at least 1")

    prior_results: list[dict] = []
    if args.retry_report:
        try:
            prior = json.loads(args.retry_report.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            parser.error(f"Could not read --retry-report: {exc}")
        prior_results = list(prior.get("results", []))
        targets = sorted({
            parse_date(str(item.get("date", "")))
            for item in prior_results
            if item.get("error") and item.get("date")
        })
        if not targets:
            parser.error("--retry-report contains no failed dates")
        date_chunks = split_dates(targets, args.workers)
    else:
        if not args.from_date or not args.through_date:
            parser.error("provide --from-date and --through-date, or --retry-report")
        if args.through_date < args.from_date:
            parser.error("--through-date cannot be earlier than --from-date")
        date_chunks = [
            [chunk_start + timedelta(days=offset) for offset in range((chunk_end - chunk_start).days + 1)]
            for chunk_start, chunk_end in split_range(args.from_date, args.through_date, args.workers)
        ]

    helper = Path(__file__).with_name("collect-junkware-forward-schedule.py")
    temp_dir = Path(tempfile.mkdtemp(prefix="junkware-forward-batch-"))
    processes: list[tuple[int, date, date, subprocess.Popen, object, Path, Path]] = []
    print(
        f"Scanning {sum(len(chunk) for chunk in date_chunks)} dates in {len(date_chunks)} isolated chunks",
        flush=True,
    )

    try:
        for index, chunk_dates in enumerate(date_chunks, start=1):
            chunk_start, chunk_end = chunk_dates[0], chunk_dates[-1]
            report_path = temp_dir / f"report-{index}.json"
            log_path = temp_dir / f"worker-{index}.log"
            dates_path = temp_dir / f"dates-{index}.txt"
            dates_path.write_text("".join(f"{target.isoformat()}\n" for target in chunk_dates), encoding="utf-8")
            log_handle = log_path.open("w", encoding="utf-8")
            command = [
                sys.executable,
                str(helper),
                "--dates-file",
                str(dates_path),
                "--opsbot-dir",
                str(args.opsbot_dir.resolve()),
                "--isolated-session",
                "--report-path",
                str(report_path),
            ]
            process = subprocess.Popen(command, stdout=log_handle, stderr=subprocess.STDOUT)
            processes.append((index, chunk_start, chunk_end, process, log_handle, report_path, log_path))

        pending = {item[0] for item in processes}
        while pending:
            for index, chunk_start, chunk_end, process, _, _, _ in processes:
                if index not in pending or process.poll() is None:
                    continue
                pending.remove(index)
                print(
                    f"Chunk {index}/{len(date_chunks)} finished ({chunk_start} through {chunk_end}) "
                    f"with exit {process.returncode}; {len(pending)} remaining",
                    flush=True,
                )
            if pending:
                time.sleep(2)
    except KeyboardInterrupt:
        for _, _, _, process, _, _, _ in processes:
            if process.poll() is None:
                process.terminate()
        raise
    finally:
        for _, _, _, _, log_handle, _, _ in processes:
            log_handle.close()

    results_by_date = {
        str(item.get("date")): item
        for item in prior_results
        if item.get("date")
    }
    worker_failures: list[dict] = []
    for index, chunk_start, chunk_end, process, _, report_path, log_path in processes:
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
            for item in report.get("results", []):
                results_by_date[str(item.get("date"))] = item
        except (FileNotFoundError, json.JSONDecodeError, OSError) as exc:
            worker_failures.append({
                "chunk": index,
                "from": chunk_start.isoformat(),
                "through": chunk_end.isoformat(),
                "exit_code": process.returncode,
                "error": str(exc),
                "log": str(log_path),
            })

    results = sorted(results_by_date.values(), key=lambda item: str(item.get("date", "")))
    appointment_dates = [
        str(item.get("date"))
        for item in results
        if int(item.get("appointments", 0)) or int(item.get("cancelled", 0))
    ]
    summary = {
        "started_at": str(results[0].get("date")) if results else None,
        "scanned_through": str(results[-1].get("date")) if results else None,
        "requested_through": str(results[-1].get("date")) if results else None,
        "last_appointment_date": max(appointment_dates) if appointment_dates else None,
        "successful_days": sum("error" not in item for item in results),
        "failed_days": sum("error" in item for item in results) + len(worker_failures),
        "appointment_rows": sum(int(item.get("appointments", 0)) for item in results),
        "worker_failures": worker_failures,
        "results": results,
    }
    report_path = args.opsbot_dir.resolve() / "data" / "history" / "junkware" / "forward_schedule_collection.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "results"}, indent=2), flush=True)

    if not worker_failures:
        shutil.rmtree(temp_dir)
    else:
        print(f"Worker logs retained at {temp_dir}", file=sys.stderr, flush=True)
    return 1 if summary["failed_days"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
