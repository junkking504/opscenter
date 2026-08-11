# JunkWare and QuickBooks Online reconciliation

OpsCenter compares the credit-card ledger in JunkWare **Accounting → Update QuickBooks** with card transactions already present in the connected **QuickBooks Online** company. The Finance page shows the result in daily and monthly views. Merchant Center is not part of this workflow.

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

## Security and safety

- The collector uses read-only GET queries and never creates, changes, deletes, refunds, or posts a QBO transaction.
- OAuth tokens are encrypted with AES-256-GCM and stored outside Git with mode 0600.
- The encryption key and Intuit application credentials are loaded from macOS Keychain and are never logged.
- A failed refresh retains the last verified reconciliation and reports the API error; it never labels stale totals as current.
- Disconnect revokes the Intuit refresh token before clearing the encrypted local token file.
