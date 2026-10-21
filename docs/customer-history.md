# Appointment customer history

The Truck Schedule appointment drawer includes a compact **Customer history**
section: this appointment's recorded amounts, explicitly linked estimates/jobs,
and possible earlier or upcoming appointments sharing the same normalized name
and phone or email. Each record uses the canonical dated appointment link to open
inside OpsCenter. Notes and addresses expand in place. No ownership fields, tasks,
review queue, account merge, or business-record mutations are introduced.

`GET /api/desktop/schedule/customer-history?appointment=<id>&date=<YYYY-MM-DD>`
requires a valid OpsCenter session and `operations.read`. The browser supplies no
contact fields. The server resolves the appointment from saved JunkWare sources
and returns at most 30 records, with explicit partial-history and unavailable
states. Absence from saved history is not proof of a new customer.

`lib/customer-history.ts` projects daily `history/junkware/junkware_*_raw.json`
archives, deduplicating appointment IDs by observation time. Existing verified
fast/requested snapshots for the selected day, today and tomorrow can update
status/date without fabricating missing detailed amounts. Exact
`source_estimate_appointment_id` links take priority. A matching name and phone
or email is labeled **Contact match**, never a confirmed account or conversion.
Names, addresses and JK numbers alone cannot join records.

Amounts are recorded JunkWare evidence, not independently verified collections.
Estimates show quotes only; billed amounts remain separate from recorded payment
methods. Tip-inclusive figures and signed adjustments remain explicit; malformed or
conflicting amounts are unavailable, and pending closeout refreshes hide stale
amounts. Saved detail timestamps remain visible, including when a newer schedule
observation updates status. Unsupported/missing values are unavailable, not zero.
Blank or null total, tip, and balance fields in older closeouts are missing values;
they do not invalidate other recorded amounts. A payment row with a missing or
malformed amount still prevents a reliable summary. Billed rows never imply collection.

History loads only while an appointment drawer is mounted. Closing/changing it
aborts the request; schedule polling does not repeat it. The server coalesces
concurrent reads and caches archive projections for 30 seconds, checking file
signatures on refresh. It never requests a collector refresh or external service.

Validation: `npm run verify:customer-history`, `npm run build:desktop`, and the
normal production build. Synthetic browser checks cover details, more/less,
empty/error/retry, appointment switching and disabled navigation while saving.

The compact selected-appointment card also shows **Booked from estimate**
directly below the customer heading when a job has an explicit source-estimate
appointment ID. It includes the estimate number, quoted amount (separate from
payment), and the same internal dated appointment link. No history request is
needed: it uses the estimate linkage already in the schedule snapshot.

## Customers under Control

Customers provides a searchable directory and a paginated account-style view
with contact details, service addresses, and all matching saved appointments.
Customer names in the Board register, selected card, and appointment drawer
link to this view. Each appointment row displays saved load/bedload sizes, load
prices, additional-charge quantities/unit prices, recorded amounts, and status
without opening its drawer. The compact history section uses the same fields.

The read-only `/api/desktop/customers` route requires authentication and
`operations.read`, serves private/no-store results, validates query length and
numeric IDs/offsets, and returns 50 rows per page. Directory search covers name,
phone, email, service address, and JK number. It reuses the coalesced saved
archive cache; no collector or external service call is made. The Customers
module loads on demand, cancels stale requests, and does not poll.

Saved archives currently lack an authoritative customer ID. URL `customer`
values are anchor appointment IDs, not new source-account IDs. Directory groups
require the same normalized name plus valid phone (or email when no phone is
available). The account view includes direct name/contact matches and explicit
estimate/job relations; it does not perform transitive contact joins or persist
merges. Differently named linked contacts remain history, not profile identity.
This matching basis is visible to operators. No parent-company, billing-contact,
or collections state is inferred. Contact changes can result in separate
directory entries when no reliable shared identifier remains.

Older summary-only archives retain their positive recorded job revenue and source
payment method, with missing payment detail stated explicitly. Revenue and
billed amounts never establish collection. Missing volume or price breakdown
is shown as not recorded; no zero or volume is inferred. Pending closeout
refreshes suppress volume and pricing along with payment amounts.

Validation: `npm run verify:customer-accounts` covers direct identity matches,
shared contact/name collisions, explicit links, no transitive merges, search,
complete pagination, source volume/price fields, legacy revenue, and pending
detail. Customer-history tests, desktop build, authenticated API checks and
browser navigation checks remain required.

Customer links preserve the viewed operating date so its saved fast snapshot can resolve the anchor. Directory counts use the same membership as the account; changed contacts may produce overlapping entries, disclosed in the directory. Revenue summary defaults of zero are omitted, and estimate revenue is never treated as a quote. Load prices are labeled line totals.
