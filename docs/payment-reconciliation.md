# JunkWare and QuickBooks Online reconciliation

OpsCenter compares the credit-card ledger in JunkWare **Accounting → Update QuickBooks** with card transactions already present in the connected **QuickBooks Online** company. The Finance page shows the result in daily and monthly views. Merchant Center is not part of this workflow.

## Finance navigation

Finance starts in **Daily close** for the selected operating date. Its sections separate the operational questions: Daily summary, Payments & recon, Company costs, Truck records, and Resale inventory. **Month to date** is a separate scope for P&L summary, payment reconciliation, costs, territory, and trend review.

Truck Records remain authoritative for the selected day’s operating totals. JunkWare is authoritative for its card-payment ledger and payment types; QuickBooks Online is the comparison source for card-payment reconciliation. Krewe-reported cost detail is supporting audit evidence, not a replacement for Truck Records totals.

## Automated workflow

The five-minute production collector runs these steps for today and yesterday:

1. Refresh the encrypted Intuit OAuth token when it is within five minutes of expiry.
2. Verify the selected QuickBooks Online company through the Accounting API.
3. Query `Payment`, `SalesReceipt`, and `PaymentMethod` entities and retain credit-card transactions.
4. Write the normalized transaction CSV and source metadata beneath the legacy-compatible import directory:

   `~/.openclaw/workspace/opsbot/data/imports/intuit_merchant_center/junk_krewe/`

5. Run the conservative payment matcher and publish reconciliation JSON beneath:

   `~/.openclaw/workspace/opsbot/data/history/payment_reconciliation/`

The directory and JSON field names remain unchanged so historical reports continue to load. New metadata identifies `qbo-accounting-api` as the collector and records the connected QBO company name.

## Matching rules

Matching is one-to-one and intentionally conservative:

- JunkWare's recorded card-paid total must agree with QBO to the cent;
- a JunkWare record that has not reached QBO remains a `Missing in QBO` exception;
- job revenue is not used as the card-payment amount;
- when the recorded card-paid total is greater than job revenue, the difference is reported as a tip;
- matching customer and date with unequal totals appears as one amount-mismatch exception;
- transaction dates may differ by at most one day;
- card last four, when QBO returns it, and customer name resolve duplicate amounts;
- ambiguous rows remain exceptions and are never silently paired.

## Governed exception review

The embedded OpsBot workflow presents the current source-backed exception rows inside Finance
control pack. A manager can request the registered
`finance.record_payment_exception_review.v1` action with a disposition, accountable
owner, next action, and evidence note. The risk-class 2 request requires approval by a
different manager or administrator.

The request carries the exact reconciliation observation hash, review-store version, and
prior review version. Approval is rejected if the exception disappears, the reconciliation
evidence changes, or another review is saved first. A review becomes visibly prior evidence
when regenerated reconciliation or new QBO collection evidence changes its observation.

The saved record is an internal follow-up ledger only. It never marks the source exception
resolved, changes JunkWare, posts or refunds a QBO transaction, or marks Daily Close
complete. Preview execution returns a verified simulation receipt and leaves the shared
review store unchanged. Review fields reject credentials, contact details, and payment-card
data.

## Security and safety

- The collector uses read-only GET queries and never creates, changes, deletes, refunds, or posts a QBO transaction.
- OAuth tokens are encrypted with AES-256-GCM and stored outside Git with mode 0600.
- The encryption key and Intuit application credentials are loaded from macOS Keychain and are never logged.
- A failed refresh retains the last verified reconciliation and reports the API error; it never labels stale totals as current.
- Disconnect revokes the Intuit refresh token before clearing the encrypted local token file.
