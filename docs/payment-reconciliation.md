# JunkWare and QuickBooks Online reconciliation

OpsCenter compares the credit-card ledger in JunkWare **Accounting → Update QuickBooks** with card transactions already present in the connected **QuickBooks Online** company. The Finance page shows the result in daily and monthly views. Merchant Center is an independent processor-evidence source alongside this accounting comparison. Its approval never substitutes for a QBO posting or verifies bank settlement.

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

## Security and safety

- The collector uses read-only GET queries and never creates, changes, deletes, refunds, or posts a QBO transaction.
- OAuth tokens are encrypted with AES-256-GCM and stored outside Git with mode 0600.
- The encryption key and Intuit application credentials are loaded from macOS Keychain and are never logged.
- A failed refresh retains the last verified reconciliation and reports the API error; it never labels stale totals as current.
- Disconnect revokes the Intuit refresh token before clearing the encrypted local token file.

## Desktop Payments tender coverage

Finance → Payments combines the card reconciliation feed with cash and check
payment rows from the selected day's JunkWare appointment closeouts. Completed
records take precedence over duplicate schedule copies; individual split tenders
remain separate. Check numbers retain their source text and leading zeroes. An
absent check number is explicitly unavailable.

Recorded Payments includes displayed card, cash, and check tenders. Cash/check
rows are marked Recorded, with no claim that a bank deposit or QBO match has been
verified. Card Payments and Card Difference retain the existing card-only QBO
reconciliation. Job Difference compares all closeout tenders with job revenue
plus tip; split-tender tips are not invented or repeated per payment.


## Merchant Center processing evidence

Finance → Payments shows three separate facts: the payment recorded against a
JunkWare job, its Merchant Center processing evidence, and its QBO accounting
match. QBO totals/differences and open accounting exceptions do not change merely
because Merchant Center approved a charge. The payment drawer labels QBO IDs as
QBO references and shows a separate Merchant Center transaction link, amount,
status, fee, and observation timestamp.

Processor snapshots live in `data/imports/merchant_center/junk_krewe/`, separate
from the legacy-named QBO import directory above. Never point the Merchant Center
collector at the QBO directory. Schema 1 snapshots identify Junk Krewe account
ending 4618, source, day, observation time, coverage, and normalized transactions.
Only explicit approved/captured/settled/funded/deposited/paid Sale or Charge rows
count toward gross approved sales; refunds, voids, failures, and unknown statuses
remain source evidence and do not count as approved sales. These totals are not
net settlement totals.

Exact cents, same date, corroborating job/card/customer identity, and one-to-one
matching are required. Conflicting job/card references block a match. Ambiguous
records stay separate. Missing rows are only called absent from an export when
that export declares complete day coverage. Individual detail observations stay
partial. Evidence older than 15 minutes for today or 24 hours for historical days
is marked for refresh; it is not silently presented as current.

The existing live-refresh loop starts `run-merchant-center-refresh.py` separately
from its QBO work. This runner uses its own lock, a 180-second process deadline,
one due export per invocation, and a 30-minute failure backoff. It revisits today,
yesterday, and unresolved days in the current month. It calls the existing
read-only Merchant Center export collector using its persistent browser session.
An expired Intuit sign-in is a collection issue; it preserves prior evidence and
cannot prevent QBO/JunkWare collection. The browser session must be authenticated
before automatic collection can succeed. Credentials are not copied from Safari.
This path does not request a new Payments API scope, post a payment, or charge a
card.

For a verified transaction detail observed separately, use schema 1 with
`collector: "merchant-center-detail"`, `complete: false`, and its actual observation
time, then run `node --import tsx scripts/import-merchant-center-evidence.ts <file>`.
Keep evidence and provenance outside Git. This adds processor evidence only; it
cannot repair QBO or JunkWare. A later complete export supersedes older details.
Run `npm run verify:merchant-evidence` for source-isolation and matching checks.
