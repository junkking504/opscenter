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
verified. Verified Card Payments and Unverified Payment Difference use the
combined QBO/processor verification described below. Job Difference compares all closeout tenders with job revenue
plus tip; split-tender tips are not invented or repeated per payment.


## Merchant Center processing evidence

Finance → Payments shows three separate facts: the payment recorded against a
JunkWare job, its Merchant Center processing evidence, and its QBO accounting
match. An exact, uniquely matched Merchant Center approval verifies the payment
and clears its amount from the operational Unverified Payment Difference, even
when QBO has no record. A QBO match also verifies a payment when that source is
available and fresh. Verified Card Payments sums each job payment once, including
when both sources match. Cash/check rows stay Recorded. The operational difference
is verified card payments minus recorded card payments; unmatched source records
remain visible in their source panels. QBO totals/differences and exceptions stay
in the separately labeled QBO Accounting section. The payment drawer labels QBO IDs as
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
is marked for refresh; it is not silently presented as current. An observed
approval continues to verify its matched payment as historical evidence; newer
void/decline observations supersede it and remove processor verification.

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

## Review and update QuickBooks from Capital → Payments

The live **Review & update QuickBooks** register reads JunkWare's native
Accounting → Update QuickBooks form, including billed receivables, cash, checks
and cards. Franchise, inclusive date range (up to 93 days), payment method and
Unsynced/Synced/Excluded filters are source-backed. All source pages are read;
incomplete or ambiguous coverage fails rather than presenting a partial total.
Billed rows count toward this register total but are never labeled collected
payments or included in the separate payment summary.

Managers select exact records, review their customers, methods and amounts,
and confirm one of three registered actions: `finance.update-quickbooks`,
`finance.exclude-from-quickbooks`, or `finance.verify-payment-and-sync`.
**Verify Payment** records the manager's cash/check/card verification and
uses JunkWare's native Update QuickBooks action for each unsynced record. An
already-synced payment can be verified without submitting it again. Card
processor approval, manager verification, JunkWare sync status, and
QBO accounting evidence remain separate. This does not charge a card, deposit
a check, move money, or create an independent QBO transaction outside JunkWare.

`POST /api/desktop/accounting` requires finance access and trusted origin; actions
and read-only recovery require `sensitive.write`. The server supplies the actor.
`scripts/junkware-accounting.py` uses the protected JunkWare authentication cookie
with a fresh ASP.NET session and native form state. An expired authentication
fails closed; the existing source-session refresh owns sign-in recovery.

Private durable receipts live in `OPSBOT_DATA_DIR/accounting-actions` (override
`OPSCENTER_ACCOUNTING_DIR` only in isolated tests). A process lock serializes
accounting mutations. The source job identity, date, amount, tender/reference,
customer, billing details and crew must still match the reviewed record. Every
individual submission is journaled and fsynced before the source POST; the exact
checkbox is selected, never Select All. JunkWare can accept updates for background processing; these remain submitted
until read-back finds the matching Synced row. Accepted queued items allow the
remaining selected records to be queued; recovery never resubmits them.
One failed item stops the remaining batch with explicit per-job results. An interrupted or uncertain submission
blocks another request for that appointment. **Check saved result** only reads
the requested Synced/Excluded source status and never replays the write. A
reused request ID returns its receipt or rejects changed content. Unknown
outcomes require source review, not clearing audit files or blind retries.

The UI keeps the request ID before submission and exposes unresolved receipts
after reopening. Cash/check verification stays visible even when source syncing
is uncertain; only a saved matching Synced row confirms the native sync. Fresh
QBO collector evidence remains a separate accounting observation below. Back up
the receipt directory with runtime data; never commit it or raw source HTML.

Validation: `python3 scripts/test-junkware-accounting.py`, desktop browser fixture,
both TypeScript projects, desktop build and production build. Synthetic tests
cover single submission, lost responses, replay rejection, stale source rows,
partial batches, exact checkbox selection and read-only recovery. A real
accounting write requires an explicitly selected, authorized source record.


## Payment cross-check navigation

Capital → Payments places **Cross-check payments** above the accounting register.
The Unverified cards and Cash & checks summary tiles open their filtered review
queues. Accounting exceptions also have **Compare sources** shortcuts. A payment
that is both unverified and missing in QBO appears once in the queue; unmatched
QBO and processor transactions remain independent records.

The selected record compares source amounts, payment method, job total, tip, and
job difference. Source observation times and stale/unavailable QBO evidence are
explicit. **Open JunkWare job** uses the native appointment ID, never the JK
number. **Open QuickBooks transaction** uses the source entity type and ID
(`SalesReceipt` or `Payment`); unknown types do not receive guessed links. The
payment evidence drawer exposes these same direct links.

A missing-QBO card payment may show **Possible related transactions** for
unmatched QBO records on the exact same date and known four-digit card suffix.
The hint displays the amount difference but does not associate, verify, post, or
change either transaction. Ambiguous accounting matches retain every candidate
and never present the first candidate as a confirmed match. Unknown amounts
remain unavailable. Review navigation makes no financial writes and leaves the
existing reviewed accounting-update workflow responsible for source changes.

## Verify Payment and morning mailbox checks

Managers collect cash/check envelopes the following morning. Select the exact
jobs and choose **Verify Payment** (`finance.verify-payment-and-sync`) to confirm
receipt and update QuickBooks together. For cards, review successful processing
before confirming; this records a manager review without replacing independent
processor evidence. Billed receivables and excluded jobs cannot use this action.
The review lists each job, method/check number and amount and explicitly states
that confirmation also updates QuickBooks. An already-synced payment is not
submitted again. Verification remains recorded if syncing needs recovery;
**Check saved result** reads the result without replaying the update.

The former receipt-only action is no longer offered in the UI. Historical
`finance.verify-payment-received` receipts retain their original meaning and
remain readable/recoverable; they are not retroactively synced. No card charge
or bank deposit is performed by Verify Payment. **Update QuickBooks** remains
available separately for billed work and other accounting-only updates.
