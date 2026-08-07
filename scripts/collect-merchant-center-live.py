#!/usr/bin/env python3
"""Refresh a Merchant Center transaction export from the persistent OpsCenter browser."""

from __future__ import annotations

import argparse
import csv
import fcntl
import io
import json
import os
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo


TIMEZONE = ZoneInfo("America/Chicago")
OPSBOT_ROOT = Path.home() / ".openclaw" / "workspace" / "opsbot"
DEFAULT_IMPORT_DIR = (
    OPSBOT_ROOT / "data" / "imports" / "intuit_merchant_center" / "junk_krewe"
)
DEFAULT_OPENCLAW = Path.home() / ".npm-global" / "bin" / "openclaw"
DEFAULT_BROWSER_PROFILE = "openclaw"
REPORTING_URL = "https://merchantcenter.intuit.com/msc/portal/reporting"
EXPECTED_ACCOUNT_NAME = "Junk Krewe"
EXPECTED_ACCOUNT_LAST_FOUR = "4618"
LOCK_PATH = Path("/private/tmp/opscenter-merchant-center-refresh.lock")
BROWSER_TAB_LABEL = "opscenter-merchant-refresh"


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.{os.getpid()}.{time.time_ns()}.tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def parse_export(content: bytes, target_date: str) -> tuple[int, float]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    required = {"Trans ID", "Date", "Card No", "Amount"}
    if not required.issubset(set(reader.fieldnames or [])):
        raise RuntimeError("Merchant Center returned an empty or unrecognized transaction export.")

    count = 0
    total = 0.0
    for row in rows:
        raw_date = str(row.get("Date") or "").split(" ", 1)[0]
        try:
            row_date = datetime.strptime(raw_date, "%m/%d/%Y").date().isoformat()
        except ValueError:
            continue
        if row_date != target_date:
            continue
        amount_text = str(row.get("Amount") or "").replace("$", "").replace(",", "")
        try:
            amount = float(amount_text)
        except ValueError:
            continue
        count += 1
        total += amount
    return count, round(total, 2)


def run_browser(openclaw: Path, profile: str, *arguments: str, timeout: int = 45) -> dict:
    command = [
        str(openclaw),
        "browser",
        "--browser-profile",
        profile,
        "--json",
        *arguments,
    ]
    process = subprocess.run(
        command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if process.returncode != 0:
        detail = (process.stderr or process.stdout).strip().splitlines()
        message = " | ".join(detail[-4:]) if detail else "no details"
        raise RuntimeError(f"Browser command failed ({arguments[0]}): {message}")
    try:
        return json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Browser command returned invalid data: {arguments[0]}") from error


def export_transactions(
    target_date: str,
    openclaw: Path,
    profile: str,
) -> tuple[bytes, str]:
    display_date = datetime.strptime(target_date, "%Y-%m-%d").strftime("%m/%d/%Y")
    tab_id = ""
    # This collector runs every five minutes from a background service. Keep
    # its persistent Chrome profile (and Intuit session), but never open a
    # visible browser window when the profile needs to be started or restarted.
    run_browser(openclaw, profile, "start", "--headless")
    try:
        tabs = run_browser(openclaw, profile, "tabs").get("tabs") or []
        existing = next(
            (
                tab
                for tab in tabs
                if tab.get("label") == BROWSER_TAB_LABEL and tab.get("type") == "page"
            ),
            None,
        )
        if existing:
            tab_id = str(existing.get("targetId") or "")
            tab_url = str(existing.get("url") or "")
        else:
            opened = run_browser(
                openclaw,
                profile,
                "open",
                REPORTING_URL,
                "--label",
                BROWSER_TAB_LABEL,
            )
            tab_id = str(opened.get("targetId") or "")
            tab_url = str(opened.get("url") or "")
        if not tab_id:
            raise RuntimeError("The persistent browser did not return a Merchant Center tab.")

        if "accounts.intuit.com" not in tab_url:
            run_browser(
                openclaw,
                profile,
                "navigate",
                REPORTING_URL,
                "--target-id",
                tab_id,
            )

        try:
            run_browser(
                openclaw,
                profile,
                "wait",
                "#account-select",
                "--target-id",
                tab_id,
                "--timeout-ms",
                "20000",
            )
        except RuntimeError as error:
            raise RuntimeError(
                "Merchant Center sign-in is required in the persistent OpsCenter browser."
            ) from error

        account_result = run_browser(
            openclaw,
            profile,
            "evaluate",
            "--target-id",
            tab_id,
            "--fn",
            """const s=document.querySelector('#account-select');
            return {
              value:s?.value||'',
              label:s?.selectedOptions?.[0]?.textContent?.trim()||'',
              expected:[...(s?.options||[])].find(o =>
                o.textContent.toLowerCase().includes('junk krewe') && o.textContent.trim().endsWith('4618')
              )?.value||''
            };""",
        ).get("result") or {}
        expected_value = str(account_result.get("expected") or "")
        if not expected_value:
            raise RuntimeError("The Junk Krewe Merchant Center account was not available.")

        if str(account_result.get("value") or "") != expected_value:
            switch_code = (
                "const s=document.querySelector('#account-select');"
                f"s.value={json.dumps(expected_value)};"
                "s.dispatchEvent(new Event('change',{bubbles:true}));"
                "return s.value;"
            )
            run_browser(
                openclaw,
                profile,
                "evaluate",
                "--target-id",
                tab_id,
                "--fn",
                switch_code,
            )
            run_browser(
                openclaw,
                profile,
                "wait",
                "--target-id",
                tab_id,
                "--fn",
                f"document.querySelector('#account-select')?.value === {json.dumps(expected_value)}",
                "--timeout-ms",
                "20000",
            )

        run_browser(
            openclaw,
            profile,
            "navigate",
            REPORTING_URL,
            "--target-id",
            tab_id,
        )
        run_browser(
            openclaw,
            profile,
            "wait",
            'a[href*="/reportingapi/transaction/export/qbms"]',
            "--target-id",
            tab_id,
            "--timeout-ms",
            "20000",
        )

        export_code = f"""const s=document.querySelector('#account-select');
        const label=s?.selectedOptions?.[0]?.textContent?.trim()||'';
        if (!label.toLowerCase().includes('junk krewe') || !label.endsWith('4618'))
          return {{status:0,error:'wrong_account',label}};
        const a=document.querySelector('a[href*="/reportingapi/transaction/export/qbms"]');
        const u=new URL(a.href);
        u.searchParams.set('fromDate',{json.dumps(display_date)});
        u.searchParams.set('toDate',{json.dumps(display_date)});
        const response=await fetch(u.href,{{credentials:'include'}});
        return {{status:response.status,body:await response.text(),label}};"""
        export_result = run_browser(
            openclaw,
            profile,
            "evaluate",
            "--target-id",
            tab_id,
            "--fn",
            export_code,
            timeout=60,
        ).get("result") or {}
        if export_result.get("error") == "wrong_account":
            raise RuntimeError(f"Refusing Merchant Center account: {export_result.get('label') or 'unknown'}")
        if int(export_result.get("status") or 0) != 200:
            raise RuntimeError(
                f"Merchant Center export failed with HTTP {export_result.get('status') or 'unknown'}."
            )
        body = str(export_result.get("body") or "").encode("utf-8")
        return body, str(export_result.get("label") or "")
    finally:
        # Keep one labeled tab open. The five-minute refresh keeps the Intuit
        # session active, and a sign-in page remains available for one-time reauthentication.
        pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=datetime.now(TIMEZONE).date().isoformat())
    parser.add_argument(
        "--openclaw",
        default=os.environ.get("OPSCENTER_OPENCLAW", str(DEFAULT_OPENCLAW)),
    )
    parser.add_argument(
        "--browser-profile",
        default=os.environ.get("OPSCENTER_BROWSER_PROFILE", DEFAULT_BROWSER_PROFILE),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_IMPORT_DIR))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target_date = date.fromisoformat(args.date).isoformat()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output = output_dir / f"transactions-{target_date}.csv"
    metadata_output = output_dir / f"transactions-{target_date}.json"

    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_PATH.open("w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status": "skipped", "reason": "refresh already running"}))
            return 75

        content, account_label = export_transactions(
            target_date,
            Path(args.openclaw).expanduser(),
            str(args.browser_profile),
        )
        transaction_count, transaction_total = parse_export(content, target_date)
        collected_at = datetime.now(TIMEZONE).isoformat()
        atomic_write(output, content)
        atomic_write(
            metadata_output,
            (json.dumps(
                {
                    "date": target_date,
                    "collected_at": collected_at,
                    "account_name": EXPECTED_ACCOUNT_NAME,
                    "account_number_last_four": EXPECTED_ACCOUNT_LAST_FOUR,
                    "account_label": account_label,
                    "transaction_count": transaction_count,
                    "transaction_total": transaction_total,
                    "source": REPORTING_URL,
                },
                indent=2,
            ) + "\n").encode("utf-8"),
        )

    print(json.dumps(
        {
            "status": "ok",
            "date": target_date,
            "output": str(output),
            "collected_at": collected_at,
            "transaction_count": transaction_count,
            "transaction_total": transaction_total,
        }
    ))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status": "error", "error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
