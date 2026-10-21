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

History loads only while an appointment drawer is mounted. Closing/changing it
aborts the request; schedule polling does not repeat it. The server coalesces
concurrent reads and caches archive projections for 30 seconds, checking file
signatures on refresh. It never requests a collector refresh or external service.

Validation: `npm run verify:customer-history`, `npm run build:desktop`, and the
normal production build. Synthetic browser checks cover details, more/less,
empty/error/retry, appointment switching and disabled navigation while saving.
