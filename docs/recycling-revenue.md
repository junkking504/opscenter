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

Supported date/ticket/amount tables (including Southern Recycling statements)
produce draft lines. Other layouts retain the original image and recognized text
for manual entry. OCR can miss or misread values, so every receipt requires review.
Finance → Recycling → Receipt Photos from OpsBot opens photos and editable dates,
tickets, materials, weights, amounts and the full receipt total. The reviewer must
confirm all pages and lines; line amounts must reconcile to the full receipt total.
Payment receipt is never inferred from a printed cash line: the reviewer must
explicitly mark payment received and enter its actual date and reference.

Recording creates one entry per ticket date with all that day's ticket references.
Zero-dollar weight deductions are excluded from commodity weight totals; weights
are not deducted twice. Missing weights remain unknown. Photos remain available
through a Finance-role-protected route; source rows and review state remain stored.

## Integrity and storage

`data/desktop-commercial/recycling-store` holds active records, receipt drafts,
and archived originals. Web edits, worker intake and the statement split share
`.write-lock`; locks are never removed based on age. Source versions reject stale
reviews. Message/photo IDs suppress retries. Already-recorded date/ticket overlaps
are rejected rather than duplicating income. A late page after recording becomes
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
