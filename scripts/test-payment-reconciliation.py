#!/usr/bin/env python3

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("collect-payment-reconciliation.py")
SPEC = importlib.util.spec_from_file_location("payment_reconciliation", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class JunkwarePaymentAmountTests(unittest.TestCase):
    def test_card_paid_total_and_revenue_produce_tip(self):
        row = {"amount": 558.80, "paid_amount": 558.80}
        details = {
            "closeout": {
                "tip": "$50.80",
                "payments": [
                    {"method": "Credit Card", "detail": "***3013", "amount": "$558.80"}
                ],
            }
        }

        MODULE.enrich_junkware_payment(row, details)

        self.assertEqual(row["revenue_amount"], 508.00)
        self.assertEqual(row["paid_amount"], 558.80)
        self.assertEqual(row["tip_amount"], 50.80)
        self.assertEqual(row["amount"], 558.80)

    def test_missing_tip_entry_does_not_infer_from_merchant_center(self):
        row = {"amount": 508.00, "revenue_amount": 508.00}
        details = {
            "closeout": {
                "tip": "",
                "payments": [
                    {"method": "Credit Card", "detail": "***3013", "amount": "$508.00"}
                ],
            }
        }

        MODULE.enrich_junkware_payment(row, details)

        self.assertEqual(row["paid_amount"], 508.00)
        self.assertEqual(row["tip_amount"], 0.0)
        self.assertEqual(row["amount"], 508.00)

    def test_csv_revenue_is_corrected_from_recorded_tip(self):
        row = MODULE.normalize_junkware_csv_row({
            "amount": "459.59",
            "paid_amount": "459.59",
            "revenue_amount": "459.59",
            "tip_amount": "59.95",
            "payment_method": "Credit Card x7617",
        })

        self.assertEqual(row["paid_amount"], 459.59)
        self.assertEqual(row["revenue_amount"], 399.64)
        self.assertEqual(row["tip_amount"], 59.95)

    def test_reconciliation_matches_total_paid_and_reports_tip(self):
        junkware = [{
            "date": "2026-08-03",
            "jk_number": "JK4038422",
            "amount": 558.80,
            "revenue_amount": 508.00,
            "paid_amount": 558.80,
            "tip_amount": 50.80,
            "customer_name": "Sarah Rosenbloom",
            "card_last_four": "3013",
        }]
        merchant = [{
            "date": "2026-08-03",
            "transaction_id": "16ad890u120q",
            "amount": 558.80,
            "customer_name": "SARAH ROSENBLOOM",
            "card_last_four": "3013",
            "status": "pending",
            "transaction_type": "SALE",
            "fee": 0.0,
        }]

        result = MODULE.reconcile("2026-08-03", junkware, merchant, MODULE_PATH)

        self.assertEqual(result["status"], "balanced")
        self.assertEqual(result["summary"]["matched_count"], 1)
        self.assertEqual(result["summary"]["tip_total"], 50.80)
        self.assertEqual(result["summary"]["exception_count"], 0)

    def test_same_identity_with_unrecorded_tip_is_one_amount_mismatch(self):
        junkware = [{
            "date": "2026-08-03",
            "jk_number": "JK4038422",
            "amount": 508.00,
            "revenue_amount": 508.00,
            "paid_amount": 508.00,
            "tip_amount": 0.0,
            "customer_name": "Sarah Rosenbloom",
            "card_last_four": "3013",
        }]
        merchant = [{
            "date": "2026-08-03",
            "transaction_id": "16ad890u120q",
            "amount": 558.80,
            "customer_name": "SARAH ROSENBLOOM",
            "card_last_four": "3013",
            "status": "pending",
            "transaction_type": "SALE",
            "fee": 0.0,
        }]

        result = MODULE.reconcile("2026-08-03", junkware, merchant, MODULE_PATH)

        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["summary"]["amount_mismatch_count"], 1)
        self.assertEqual(result["summary"]["exception_count"], 1)
        self.assertEqual(result["summary"]["tip_total"], 0.0)
        self.assertEqual(result["exceptions"]["missing_in_merchant_center"], [])
        self.assertEqual(result["exceptions"]["merchant_center_only"], [])
        self.assertEqual(result["exceptions"]["amount_mismatch"][0]["amount_difference"], 50.80)


if __name__ == "__main__":
    unittest.main()
