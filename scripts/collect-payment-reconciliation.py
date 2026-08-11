#!/usr/bin/env python3
"""Reconcile JunkWare Update QuickBooks card payments with QuickBooks Online."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


TIMEZONE = ZoneInfo("America/Chicago")
OPSBOT_ROOT = Path.home() / ".openclaw" / "workspace" / "opsbot"
OPSBOT_SCRIPTS = OPSBOT_ROOT / "scripts"
DEFAULT_OUTPUT_DIR = OPSBOT_ROOT / "data" / "history" / "payment_reconciliation"
EXPECTED_MERCHANT_ACCOUNT_NAME = "Junk Krewe"
EXPECTED_MERCHANT_ACCOUNT_LAST_FOUR = "4618"
DEFAULT_IMPORT_DIR = (
    OPSBOT_ROOT / "data" / "imports" / "intuit_merchant_center" / "junk_krewe"
)
JUNKWARE_URL = "https://junkware.junk-king.com/franchise/accounting/update-quickbooks.aspx"


def clean(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def header_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", clean(value).lower())


def money(value: Any) -> float:
    text = clean(value).replace(",", "")
    negative = text.startswith("(") and text.endswith(")")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return 0.0
    amount = float(match.group(0))
    return round(-abs(amount) if negative else amount, 2)


def iso_date(value: Any) -> str:
    text = clean(value)
    if not text:
        return ""
    for fmt in (
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%m-%d-%Y",
        "%Y/%m/%d",
        "%b %d, %Y",
        "%B %d, %Y",
    ):
        try:
            return datetime.strptime(text.split(" ", 1)[0] if fmt == "%Y-%m-%d" else text, fmt).date().isoformat()
        except ValueError:
            continue
    match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", text)
    if match:
        year = int(match.group(3))
        if year < 100:
            year += 2000
        try:
            return date(year, int(match.group(1)), int(match.group(2))).isoformat()
        except ValueError:
            return ""
    return ""


def last_four(value: Any) -> str:
    text = clean(value)
    match = re.search(r"(?:x+|\*+|ending\s+in\s+)?(\d{4})\b", text, re.I)
    return match.group(1) if match else ""


def normalized_name(value: Any) -> str:
    text = re.sub(r"[^a-z0-9 ]", " ", clean(value).lower())
    ignored = {"the", "inc", "llc", "customer", "card"}
    return " ".join(token for token in text.split() if token not in ignored)


def name_overlap(left: str, right: str) -> float:
    left_tokens = set(normalized_name(left).split())
    right_tokens = set(normalized_name(right).split())
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / max(len(left_tokens), len(right_tokens))


def days_apart(left: str, right: str) -> int:
    try:
        return abs((date.fromisoformat(left) - date.fromisoformat(right)).days)
    except ValueError:
        return 999


def atomic_json_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.{os.getpid()}.{time.time_ns()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


def select_option_value(page, selector: str, label: str) -> None:
    locator = page.locator(selector)
    if locator.count() != 1:
        raise RuntimeError(f"JunkWare control not found: {selector}")
    locator.select_option(label=label)


def submit_junkware_filter(page, target_date: str, status_label: str) -> None:
    display_date = datetime.strptime(target_date, "%Y-%m-%d").strftime("%m/%d/%Y")
    page.locator("#ctl00_Content_FromDateTB").fill(display_date)
    page.locator("#ctl00_Content_ToDateTB").fill(display_date)
    select_option_value(page, "#ctl00_Content_ServiceProviderGroupDD", "All")
    select_option_value(page, "#ctl00_Content_PaymentMethodDD", "Credit Card")
    select_option_value(page, "#ctl00_Content_StatusDD", status_label)
    page.locator("#ctl00_Content_SubmitBtn").click(no_wait_after=True)
    page.wait_for_timeout(2500)


def extract_junkware_page(page, sync_status: str) -> list[dict[str, Any]]:
    raw_rows = page.evaluate(
        """() => {
          const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const table = [...document.querySelectorAll('table.list')].find((node) =>
            /JK Number/i.test(node.textContent || '') && /Pymt Method/i.test(node.textContent || '')
          );
          if (!table) return [];
          return [...table.querySelectorAll('tr')].slice(1).map((row) => {
            const cells = [...row.querySelectorAll(':scope > th, :scope > td')]
              .map((cell) => clean(cell.textContent));
            const appointmentLink = row.querySelector('a[href*="appointment.aspx"]');
            const appointmentId = String(appointmentLink?.href || '').match(/[?&]id=(\d+)/i)?.[1] || '';
            return { cells, appointmentId };
          }).filter((row) => row.cells.length >= 9);
        }"""
    )
    rows: list[dict[str, Any]] = []
    for raw_row in raw_rows:
        cells = raw_row["cells"]
        payment_method = clean(cells[4])
        if "credit card" not in payment_method.lower():
            continue
        rows.append(
            {
                "date": iso_date(cells[1]),
                "jk_number": clean(cells[2]),
                "appt_id": clean(raw_row.get("appointmentId")),
                "amount": money(cells[3]),
                "revenue_amount": money(cells[3]),
                "paid_amount": money(cells[3]),
                "tip_amount": 0.0,
                "payment_method": payment_method,
                "card_last_four": last_four(payment_method),
                "customer_name": clean(cells[5]),
                "billing_email": clean(cells[6]),
                "email": clean(cells[7]),
                "crew": re.sub(r"\s+edit$", "", clean(cells[8]), flags=re.I),
                "junkware_sync_status": sync_status,
            }
        )
    return rows


def enrich_junkware_payment(row: dict[str, Any], details: dict[str, Any] | None) -> None:
    """Attach the job revenue, recorded card-paid total, and tip from JunkWare closeout."""
    listed_paid = money(row.get("paid_amount") or row.get("amount"))
    closeout = (details or {}).get("closeout") or {}
    payments = closeout.get("payments") or []
    card_paid = round(
        sum(
            money(payment.get("amount"))
            for payment in payments
            if "card" in clean(payment.get("method")).lower()
        ),
        2,
    )
    paid = card_paid if card_paid > 0 else listed_paid
    explicit_tip = money(closeout.get("tip"))
    revenue = round(max(0.0, paid - explicit_tip), 2) if explicit_tip > 0 else paid

    row["revenue_amount"] = revenue
    row["paid_amount"] = paid
    row["tip_amount"] = explicit_tip
    # Matching is based on what JunkWare says was actually paid, not job revenue.
    row["amount"] = paid


def normalize_junkware_csv_row(row: dict[str, Any]) -> dict[str, Any]:
    paid = money(row.get("paid_amount") or row.get("amount"))
    tip = money(row.get("tip_amount"))
    revenue = money(row.get("revenue_amount") or row.get("amount"))
    if tip > 0 and abs((revenue + tip) - paid) > 0.01:
        revenue = round(max(0.0, paid - tip), 2)
    return {
        **row,
        "amount": paid,
        "revenue_amount": revenue,
        "paid_amount": paid,
        "tip_amount": tip,
        "card_last_four": last_four(row.get("card_last_four") or row.get("payment_method")),
    }


def collect_junkware(target_date: str) -> list[dict[str, Any]]:
    if str(OPSBOT_SCRIPTS) not in sys.path:
        sys.path.insert(0, str(OPSBOT_SCRIPTS))
    import collect_junkware_daily as collector

    all_rows: list[dict[str, Any]] = []
    try:
        collector.ensure_authenticated(JUNKWARE_URL)
        for status_label in ("Unsynced", "Synced"):
            submit_junkware_filter(collector.page, target_date, status_label)
            seen_pages: set[str] = set()
            while True:
                page_rows = extract_junkware_page(collector.page, status_label.lower())
                fingerprint = json.dumps(page_rows, sort_keys=True)
                if fingerprint in seen_pages:
                    break
                seen_pages.add(fingerprint)
                all_rows.extend(page_rows)

                next_button = collector.page.locator(
                    "#ctl00_Content_ListView1_DataPager1_ctl00_NextPageBtn"
                )
                if next_button.count() != 1 or next_button.is_disabled():
                    break
                disabled = next_button.get_attribute("disabled")
                source = next_button.get_attribute("src") or ""
                if disabled is not None or "disabled" in source.lower():
                    break
                next_button.click(no_wait_after=True)
                collector.page.wait_for_timeout(2000)

        detail_map = collector.collect_appointment_details(all_rows)
        for row in all_rows:
            enrich_junkware_payment(row, detail_map.get(clean(row.get("appt_id"))))
    finally:
        collector.close_browser()

    deduped: dict[str, dict[str, Any]] = {}
    for row in all_rows:
        key = "|".join(
            [row["date"], row["jk_number"], f"{row['paid_amount']:.2f}", row["junkware_sync_status"]]
        )
        deduped[key] = row
    return sorted(deduped.values(), key=lambda row: (row["date"], row["jk_number"], row["amount"]))


ALIASES = {
    "date": ["date", "transactiondate", "processeddate", "processingdate", "paymentdate", "datetime"],
    "id": ["transactionid", "transactionnumber", "transid", "txn", "id", "referencenumber"],
    "amount": ["amount", "total", "grossamount", "transactionamount", "paymentamount"],
    "status": ["status", "transactionstatus", "paymentstatus"],
    "type": ["type", "transactiontype", "paymenttype"],
    "name": ["customername", "customer", "cardholdername", "cardholder", "payername", "name"],
    "card": ["cardnumber", "cardno", "accountnumber", "lastfour", "last4", "card", "paymentmethod"],
    "fee": ["fee", "fees", "processingfee", "discountfee"],
    "net": ["net", "netamount", "depositamount"],
    "merchant_account": [
        "merchantaccountname", "merchantname", "businessname", "companyname", "merchantaccount",
    ],
    "merchant_account_number": [
        "merchantaccountnumber", "merchantnumber", "merchantid", "merchantaccountid",
    ],
}


def first_value(row: dict[str, str], alias_name: str) -> str:
    normalized = {header_key(key): clean(value) for key, value in row.items()}
    for alias in ALIASES[alias_name]:
        if normalized.get(alias):
            return normalized[alias]
    return ""


def find_merchant_export(target_date: str, explicit: str | None) -> Path | None:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Merchant Center export not found: {path}")
        return path
    DEFAULT_IMPORT_DIR.mkdir(parents=True, exist_ok=True)
    candidates = sorted(DEFAULT_IMPORT_DIR.glob("*.csv"), key=lambda path: path.stat().st_mtime, reverse=True)
    dated = [path for path in candidates if target_date in path.name]
    return (dated or candidates or [None])[0]


def merchant_collected_at(path: Path | None, target_date: str) -> str | None:
    if path is None:
        return None
    metadata_path = path.with_suffix(".json")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        legacy_account_matches = (
            normalized_name(metadata.get("account_name"))
            == normalized_name(EXPECTED_MERCHANT_ACCOUNT_NAME)
            and clean(metadata.get("account_number_last_four"))
            == EXPECTED_MERCHANT_ACCOUNT_LAST_FOUR
        )
        qbo_api_identity = (
            metadata.get("collector") == "qbo-accounting-api"
            and clean(metadata.get("qbo_company_name"))
            and normalized_name(metadata.get("account_name"))
            == normalized_name(metadata.get("qbo_company_name"))
        )
        if (
            metadata.get("date") == target_date
            and (legacy_account_matches or qbo_api_identity)
            and metadata.get("collected_at")
        ):
            return str(metadata["collected_at"])
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return datetime.fromtimestamp(path.stat().st_mtime, TIMEZONE).isoformat()


def merchant_source_metadata(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    try:
        return json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def path_is_within(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def validate_merchant_account(path: Path, rows: list[dict[str, str]]) -> None:
    names = {first_value(row, "merchant_account") for row in rows}
    numbers = {first_value(row, "merchant_account_number") for row in rows}
    names.discard("")
    numbers.discard("")

    metadata = merchant_source_metadata(path)
    if metadata.get("collector") == "qbo-accounting-api":
        qbo_company_name = clean(metadata.get("qbo_company_name"))
        if not qbo_company_name:
            raise RuntimeError("QBO source metadata does not identify the connected company.")
        if names and any(normalized_name(value) != normalized_name(qbo_company_name) for value in names):
            raise RuntimeError("QBO transaction rows do not match the connected company metadata.")
        return

    if names or numbers:
        expected_name = normalized_name(EXPECTED_MERCHANT_ACCOUNT_NAME)
        names_match = not names or all(normalized_name(value) == expected_name for value in names)
        numbers_match = not numbers or all(
            last_four(value) == EXPECTED_MERCHANT_ACCOUNT_LAST_FOUR for value in numbers
        )
        if not names_match or not numbers_match:
            found = ", ".join(sorted(names or {f"account ending {last_four(value)}" for value in numbers}))
            raise RuntimeError(
                f"Merchant Center export is for {found or 'another account'}; "
                f"OpsCenter only accepts {EXPECTED_MERCHANT_ACCOUNT_NAME}."
            )
        return

    if not path_is_within(path, DEFAULT_IMPORT_DIR):
        raise RuntimeError(
            "Merchant Center export does not identify its merchant account. "
            f"Place the Junk Krewe export in {DEFAULT_IMPORT_DIR} before importing it."
        )


def normalize_merchant_rows(path: Path, target_date: str) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    target = date.fromisoformat(target_date)
    raw_rows = read_csv_rows(path)
    validate_merchant_account(path, raw_rows)
    for index, row in enumerate(raw_rows, start=2):
        transaction_date = iso_date(first_value(row, "date"))
        if not transaction_date:
            continue
        parsed_date = date.fromisoformat(transaction_date)
        if abs((parsed_date - target).days) > 1:
            continue
        transaction_type = first_value(row, "type") or "sale"
        status = first_value(row, "status") or "reported"
        amount_value = money(first_value(row, "amount"))
        if amount_value == 0:
            continue
        normalized.append(
            {
                "date": transaction_date,
                "transaction_id": first_value(row, "id") or f"row-{index}",
                "amount": abs(amount_value),
                "customer_name": first_value(row, "name"),
                "card_last_four": last_four(first_value(row, "card")),
                "status": status,
                "transaction_type": transaction_type,
                "fee": abs(money(first_value(row, "fee"))),
                "net": money(first_value(row, "net")),
                "source_row": index,
                "merchant_account_name": EXPECTED_MERCHANT_ACCOUNT_NAME,
                "merchant_account_last_four": EXPECTED_MERCHANT_ACCOUNT_LAST_FOUR,
            }
        )
    return normalized


def merchant_is_successful_sale(row: dict[str, Any]) -> bool:
    status = clean(row.get("status")).lower()
    transaction_type = clean(row.get("transaction_type")).lower()
    if re.search(r"declin|fail|void|cancel|reject", status):
        return False
    if re.search(r"refund|credit|chargeback|return", transaction_type):
        return False
    return True


def candidate_score(junkware: dict[str, Any], merchant: dict[str, Any]) -> int:
    if abs(float(junkware["amount"]) - float(merchant["amount"])) > 0.01:
        return -1
    distance = days_apart(junkware["date"], merchant["date"])
    if distance > 1:
        return -1
    score = 40 + (15 if distance == 0 else 5)
    jw_card = clean(junkware.get("card_last_four"))
    mc_card = clean(merchant.get("card_last_four"))
    if jw_card and mc_card:
        if jw_card != mc_card:
            return -1
        score += 35
    overlap = name_overlap(junkware.get("customer_name", ""), merchant.get("customer_name", ""))
    if overlap == 1:
        score += 30
    elif overlap >= 0.5:
        score += 15
    return score


def same_payment_identity(junkware: dict[str, Any], merchant: dict[str, Any]) -> bool:
    """Identify a likely same payment without treating an amount difference as a tip."""
    if days_apart(junkware["date"], merchant["date"]) > 1:
        return False
    jw_card = clean(junkware.get("card_last_four"))
    mc_card = clean(merchant.get("card_last_four"))
    if not jw_card or not mc_card or jw_card != mc_card:
        return False
    return name_overlap(
        junkware.get("customer_name", ""), merchant.get("customer_name", "")
    ) >= 0.5


def reconcile(
    target_date: str,
    junkware_rows: list[dict[str, Any]],
    merchant_rows: list[dict[str, Any]],
    merchant_source: Path | None,
) -> dict[str, Any]:
    merchant_sales = [row for row in merchant_rows if merchant_is_successful_sale(row)]
    selected_merchant: set[int] = set()
    matches: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    missing_merchant: list[dict[str, Any]] = []
    amount_mismatches: list[dict[str, Any]] = []
    unmatched_junkware: list[dict[str, Any]] = []

    amount_counts = Counter(round(float(row["amount"]), 2) for row in merchant_sales)
    for junkware in junkware_rows:
        candidates = []
        for index, merchant in enumerate(merchant_sales):
            if index in selected_merchant:
                continue
            score = candidate_score(junkware, merchant)
            if score >= 0:
                candidates.append((score, index, merchant))
        candidates.sort(key=lambda item: (-item[0], item[2]["date"], item[2]["transaction_id"]))
        if not candidates:
            unmatched_junkware.append(junkware)
            continue

        top_score, top_index, top_merchant = candidates[0]
        tied = [item for item in candidates if item[0] == top_score]
        has_identity = bool(
            (junkware.get("card_last_four") and top_merchant.get("card_last_four"))
            or name_overlap(junkware.get("customer_name", ""), top_merchant.get("customer_name", "")) >= 0.5
        )
        unique_amount = amount_counts[round(float(junkware["amount"]), 2)] == 1
        if len(tied) > 1 or (not has_identity and not unique_amount):
            ambiguous.append(
                {
                    "junkware": junkware,
                    "candidates": [item[2] for item in tied[:5]],
                    "reason": "Multiple Merchant Center transactions share the same amount and date.",
                }
            )
            continue

        selected_merchant.add(top_index)
        matches.append(
            {
                "junkware": junkware,
                "merchant_center": top_merchant,
                "amount_difference": round(float(top_merchant["amount"]) - float(junkware["amount"]), 2),
                "match_confidence": "exact" if top_score >= 90 else "probable",
                "match_basis": [
                    "amount",
                    "date" if junkware["date"] == top_merchant["date"] else "adjacent date",
                    *( ["card last four"] if junkware.get("card_last_four") and top_merchant.get("card_last_four") else [] ),
                    *( ["customer"] if name_overlap(junkware.get("customer_name", ""), top_merchant.get("customer_name", "")) >= 0.5 else [] ),
                ],
            }
        )

    # A strong date/card/customer identity means these are likely the same
    # payment, but unequal recorded totals must remain a single review item.
    # The difference is not called a tip until JunkWare's paid total includes it.
    for junkware in unmatched_junkware:
        identity_candidates = [
            (index, merchant)
            for index, merchant in enumerate(merchant_sales)
            if index not in selected_merchant and same_payment_identity(junkware, merchant)
        ]
        if len(identity_candidates) != 1:
            missing_merchant.append(junkware)
            continue
        merchant_index, merchant = identity_candidates[0]
        selected_merchant.add(merchant_index)
        amount_mismatches.append(
            {
                "junkware": junkware,
                "merchant_center": merchant,
                "amount_difference": round(
                    float(merchant["amount"]) - float(junkware["amount"]), 2
                ),
                "reason": "Customer, card, and date match, but recorded paid totals differ.",
            }
        )

    merchant_only = [
        row
        for index, row in enumerate(merchant_sales)
        if index not in selected_merchant and row["date"] == target_date
    ]
    junkware_total = round(sum(float(row["amount"]) for row in junkware_rows), 2)
    merchant_day_rows = [row for row in merchant_sales if row["date"] == target_date]
    merchant_total = round(sum(float(row["amount"]) for row in merchant_day_rows), 2)
    matched_total = round(sum(float(row["junkware"]["amount"]) for row in matches), 2)
    tip_total = round(sum(float(row.get("tip_amount") or 0) for row in junkware_rows), 2)
    processing_fees = round(sum(float(row.get("fee") or 0) for row in merchant_day_rows), 2)
    exception_count = (
        len(missing_merchant) + len(merchant_only) + len(ambiguous) + len(amount_mismatches)
    )
    merchant_available = merchant_source is not None
    balanced = merchant_available and exception_count == 0 and abs(merchant_total - junkware_total) <= 0.01

    source_metadata = merchant_source_metadata(merchant_source)
    qbo_api_source = source_metadata.get("collector") == "qbo-accounting-api"

    return {
        "date": target_date,
        "generated_at": datetime.now(TIMEZONE).isoformat(),
        "status": "balanced" if balanced else ("merchant_data_missing" if not merchant_available else "needs_review"),
        "sources": {
            "junkware": {
                "name": "JunkWare Accounting → Update QuickBooks",
                "url": JUNKWARE_URL,
                "available": True,
            },
            "merchant_center": {
                "name": (
                    f"QuickBooks Online API — {source_metadata.get('qbo_company_name') or 'Connected company'}"
                    if qbo_api_source
                    else "Intuit Merchant Center Transactions — Junk Krewe"
                ),
                "url": (
                    "https://ops.junk-king.app/integrations/qbo/status"
                    if qbo_api_source
                    else "https://merchantcenter.intuit.com/msc/portal/home"
                ),
                "available": merchant_available,
                "file": str(merchant_source) if merchant_source else None,
                "collected_at": merchant_collected_at(merchant_source, target_date),
                "account_name": (
                    source_metadata.get("qbo_company_name")
                    if qbo_api_source
                    else EXPECTED_MERCHANT_ACCOUNT_NAME
                ),
                "account_number_last_four": (
                    None if qbo_api_source else EXPECTED_MERCHANT_ACCOUNT_LAST_FOUR
                ),
                "qbo_company_name": source_metadata.get("qbo_company_name") if qbo_api_source else None,
                "collector": source_metadata.get("collector") or "merchant-center-export",
            },
        },
        "summary": {
            "junkware_count": len(junkware_rows),
            "junkware_total": junkware_total,
            "merchant_center_count": len(merchant_day_rows),
            "merchant_center_total": merchant_total,
            "matched_count": len(matches),
            "matched_total": matched_total,
            "tip_total": tip_total,
            "missing_in_merchant_center_count": len(missing_merchant),
            "merchant_center_only_count": len(merchant_only),
            "ambiguous_count": len(ambiguous),
            "amount_mismatch_count": len(amount_mismatches),
            "exception_count": exception_count,
            "net_difference": round(merchant_total - junkware_total, 2),
            "processing_fees": processing_fees,
        },
        "matches": matches,
        "exceptions": {
            "missing_in_merchant_center": missing_merchant,
            "merchant_center_only": merchant_only,
            "ambiguous": ambiguous,
            "amount_mismatch": amount_mismatches,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=datetime.now(TIMEZONE).date().isoformat())
    parser.add_argument("--merchant-csv", help="Merchant Center Transactions CSV export")
    parser.add_argument("--junkware-csv", help="Use an existing normalized JunkWare CSV instead of scraping")
    parser.add_argument("--output", help="Override reconciliation JSON output path")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target_date = date.fromisoformat(args.date).isoformat()
    output_dir = Path(args.output_dir).expanduser().resolve()
    junkware_csv = output_dir / f"junkware_update_quickbooks_{target_date}.csv"
    if args.junkware_csv:
        junkware_rows = [
            normalize_junkware_csv_row(row)
            for row in read_csv_rows(Path(args.junkware_csv).expanduser().resolve())
        ]
    else:
        junkware_rows = collect_junkware(target_date)
        write_csv(
            junkware_csv,
            junkware_rows,
            [
                "date", "jk_number", "appt_id", "amount", "revenue_amount", "paid_amount",
                "tip_amount", "payment_method", "card_last_four",
                "customer_name", "billing_email", "email", "crew", "junkware_sync_status",
            ],
        )

    merchant_source = find_merchant_export(target_date, args.merchant_csv)
    merchant_rows = normalize_merchant_rows(merchant_source, target_date) if merchant_source else []
    if merchant_source:
        write_csv(
            output_dir / f"intuit_merchant_center_{target_date}.csv",
            merchant_rows,
            [
                "date", "transaction_id", "amount", "customer_name", "card_last_four",
                "status", "transaction_type", "fee", "net", "source_row",
                "merchant_account_name", "merchant_account_last_four",
            ],
        )

    payload = reconcile(target_date, junkware_rows, merchant_rows, merchant_source)
    output = Path(args.output).expanduser().resolve() if args.output else output_dir / f"payment_reconciliation_{target_date}.json"
    atomic_json_write(output, payload)
    print(json.dumps({"status": payload["status"], "output": str(output), **payload["summary"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
