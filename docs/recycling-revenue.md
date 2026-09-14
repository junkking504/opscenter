# Metal recycling revenue

Finance → Recycling shows all recorded runs in the selected month, grouped by
run or yard ticket date. The month control is independent of the operating-day
selector and is retained in the `recyclingMonth` URL parameter. Each run has a
separate payment received date. Run value and payments received are two views
of the same income; they must not be added together. Legacy paid records without
a payment date are flagged and excluded from monthly cash-received totals.

## OpsBot receipt photos

Send `Recycling` to the existing OpsBot WhatsApp number, followed by every page
of one receipt within ten minutes. Alternatively caption the first photo
`Recycling`, then send remaining pages without captions. Send a new `Recycling`
message before a different receipt. Context is bound when each image is queued,
scoped to sender and receiving number; conflicting context never routes a photo.

The existing worker intercepts receipt images before appointment matching. It
uses the existing Meta media download and Apple Vision text recognition locally
on Mission Control. No new provider, metered AI request, or polling service is
introduced. Apple API: https://developer.apple.com/documentation/vision/vnrecognizetextrequest

### Delivery tickets and monthly cash-out

Delivery tickets are evidence of material delivered, independent of payment. A
reviewed ticket creates one run per yard, date and ticket number, with material,
net weight and the original photo. Expected and received value remain unknown;
recording a delivery never invents a price or marks it paid.

Single-material EMR FRAG FEED purchase tickets extract their ticket number,
date and net pounds locally. Existing unrecorded photos recover these fields
from their saved OCR text on read, without another download or provider call.
Ambiguous or other layouts retain the original image for manual entry. In
Finance → Recycling → Delivery Tickets & Cash-out Statements, choose Delivery
ticket, check the source fields, and select Record Delivery Tickets. No dollar
amount is required. Every OCR result still needs review.

Monthly cash-out statements use the existing date/ticket/amount extraction.
Choose Monthly cash-out statement and check the matching preview, amounts and
full statement total. Matching requires the same normalized yard name, date and
exact ticket number. Punctuation and legal suffix differences are ignored; yard
aliases are not guessed. Confirm the yard consistently on both documents.

A cash-out line updates the existing delivery instead of creating a second run.
Original delivery lines, photo and weight remain separate from statement lines
and weight. Weight differences or missing comparison weights remain visible;
reviewing or paying a statement does not clear them. Statement-only tickets can
be recorded and later linked to their delivery photos. Paid amounts and the
original payment date survive that later link. Already matched or ambiguous
records are rejected; matching also checks the saved versions the reviewer saw.
Legacy aggregate statement entries remain intact and require explicit review
before any overlapping ticket can be recorded.

The monthly reconciliation shows delivery tickets and net pounds, tickets still
awaiting cash-out matching, matches awaiting payment, weight exceptions and
statement entries without a linked delivery. Omitted deliveries stay open after
a statement is recorded. These lists do not prove a statement is complete: check
them against every ticket collected for that month. New statement entries are
stored per ticket and grouped by date in the daily display.

Statement line amounts must reconcile exactly to the full cash-out total.
Payment receipt is never inferred from a printed cash line: the reviewer must
explicitly mark payment received and enter its actual date and reference.
Zero-dollar weight deductions are excluded from commodity weight totals; weights
are not deducted twice. Missing weights remain unknown. Photos remain available
through a Finance-role-protected route; source rows and review state remain stored.

## Slack alerts

The existing WhatsApp photo worker delivers metal recycling alerts to `#payment`
(`SLACK_OPS_PAYMENT_CHANNEL_ID`) when OpsCenter Slack alerts are enabled. One
message belongs to each receipt: incoming pages update its review notice, and
recording the receipt updates that message with the run dates, daily amounts,
total revenue, and separately recorded payment date. Manual runs also alert.
Edits update the original message; repeated worker cycles do not repost it.
The existing recorded statement is announced once when this feature starts.
Private photos remain in Finance behind login; Slack includes the Finance link.

Delivery receipts live in `desktop-commercial/slack-deliveries.json`, independent
of the selected operating day and release. A separate process-owner lock prevents
overlapping delivery; unreadable delivery history stops publishing. Failed Slack
requests retain their pending state for retry by the existing worker. No new
service or polling loop is added. Verification: `node --import tsx scripts/test-recycling-slack.ts`.

## Integrity and storage

`data/desktop-commercial/recycling-store` holds active records, receipt drafts,
and archived originals. Web edits, worker intake and the statement split share
`.write-lock`; locks are never removed based on age. Source versions reject stale
reviews. Message/photo IDs suppress retries. Already-recorded yard/date/ticket overlaps
are matched only between a delivery and its statement, or rejected rather than
duplicating deliveries or income. A late page after recording becomes
a new review draft. Original photos are kept in `receipt-photos`; original statement
transcriptions and import backups remain under the existing evidence directory.

`scripts/split-recycling-statement.ts` imports a preverified local statement into
daily entries. It defaults to a dry run and requires explicit source/store paths,
an aggregate record ID and `--apply` to write. It validates amounts, ticket counts,
and weights, backs up the entire store, archives the original aggregate, replaces
it with dated allocations, preserves the original payment date, and reads back
the result. Reruns return the prior import without duplicating records.

Nothing in this workflow posts to QBO or claims a bank deposit. Synthetic tests:
`npm run verify:recycling`; existing WhatsApp context/media and resale regressions
also cover the shared intake path. Never send test receipts to real recipients.
