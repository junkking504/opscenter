# JunkWare and Intuit Merchant Center payment reconciliation

OpsCenter compares the credit-card ledger in JunkWare **Accounting → Update QuickBooks** with the **Transactions** report for the **Junk Krewe** account in Intuit Merchant Center. The result appears on the Finance page in both daily and monthly views. No other Merchant Center account is accepted.

## Daily workflow

1. In [Intuit Merchant Center](https://merchantcenter.intuit.com/msc/portal/home), select **Junk Krewe**, then open **Activity & Reports → Transactions**.
2. Select the date or date range and export the report as CSV.
3. Save the export in:

   `~/.openclaw/workspace/opsbot/data/imports/intuit_merchant_center/junk_krewe/`

4. Run:

   `npm run reconcile:payments -- --date YYYY-MM-DD`

The collector reads JunkWare, finds the latest Merchant Center CSV, and writes:

- the normalized JunkWare card ledger;
- the normalized Merchant Center ledger;
- a daily reconciliation JSON file consumed by Finance.

The output directory is:

`~/.openclaw/workspace/opsbot/data/history/payment_reconciliation/`

An export outside the Junk Krewe import directory can be supplied directly with `--merchant-csv /path/to/export.csv` only when the CSV itself identifies the Junk Krewe merchant account. Ambiguous exports and exports identifying a different account fail closed.

## Matching rules

Matching is one-to-one and intentionally conservative:

- JunkWare's recorded card-paid total must agree with Merchant Center to the cent;
- job revenue is not used as the card-payment amount;
- when the recorded card-paid total is greater than job revenue, the difference is reported as a tip;
- matching customer, card, and date with unequal paid totals appears as one amount-mismatch exception and is not automatically called a tip;
- transaction dates may differ by at most one day;
- card last four and customer name resolve duplicate amounts;
- ambiguous rows remain exceptions and are never silently paired;
- declined, failed, voided, and rejected Merchant Center rows are not treated as successful sales.

The Finance panel reports matched paid totals, tips, the Merchant Center minus JunkWare paid-total difference, processing fees when present in the export, and three exception types:

- missing in Merchant Center;
- Merchant Center only;
- ambiguous match;
- amount mismatch.

## Safety

The collector is read-only. It never selects JunkWare rows and never presses **Update QuickBooks** or **Exclude from QB**. It also does not create, void, refund, or modify Merchant Center transactions. Both the collector and the Finance data reader enforce the Junk Krewe account boundary.
