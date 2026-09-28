# Visit tracking and unload agents

OpsCenter separates two ongoing deterministic operational agents. They use
already collected local evidence and require no AI calls, new paid services or
additional provider polling. The existing refresh and V3 ingestion cadence drives
the background runner; on-demand projections use the same functions.

## Visit tracking agent

`visit-tracking` owns only geofence and appointment arrival/departure state.
`lib/visit-tracking-agent.ts` contains the deterministic transition rules;
`readVisitTrackingAgent` in `lib/visit-tracking-reader.ts` reads local sources.
Its normalized `TrackedVisit` contract records source evidence, stable episode
identity and aliases, first observation, last onsite observation, optional departure
bounds, exact duration only where supported, and source timestamps.

Native geofence transitions and positive V3 named-facility reports share one
ordered replay. Provider retries deduplicate, known facility aliases reconcile,
and a real return after departure starts a separate episode. A later positive
report at another known facility establishes that the truck departed the first.
Its exit is explicitly bounded **after the last onsite report and by the later
facility report**; the later timestamp is not an exact exit time. Missing facility
fields, unknown overlapping zones, another truck and future timestamps do not
close a visit. Midnight uses Chicago operating dates and prior-day context.

A native exit later received within the inferred bounds replaces the inferred
exit when replayed. An exit timestamp contradicting a newer different-facility
position retains one bounded visit with a conflict flag. Distinct repeated native
entries without an exit retain `firstObservedAt` for the episode while exact
arrival/duration remain unavailable. Source aliases preserve reconciliation when
an earlier native arrival later supplements a V3 episode.

Appointment visits require the collector's confirmed appointment/truck
attribution. Any recorded position inside verified premises counts under the
policy below; legacy unconfirmed pass-by rows are not promoted without replay.
Separate return intervals remain separate visits.
A source-linked estimate and job may describe one customer stop. When both
appointment IDs receive the exact same truck/arrival/departure episode, the
linked job owns the physical visit and the estimate remains a separate source
record without a second truck-board block. Distinct GPS episodes remain distinct.
A cross-appointment collision invariant prevents one physical episode from being
silently counted twice.
A completed interval replaces a stale open revision of the same arrival, in either
input order. Different confirmed departures for one arrival remain conflicts.
Operational confirmation remains distinct from exact GPS timing. Tracking does
not close out appointments or change their assigned trucks.

Read-side freshness includes the native alert collector's failed/stale status and
separate latest position and appointment observation times. A retained previously
successful native snapshot does not become current when later collection fails.
Command's compact Onsite summary shows inferred departure bounds directly.

## Unload and cost agent

The downstream `unload-cost` agent consumes normalized visits and owns unload
assumptions and provisional dump costs. Visit tracking performs no load resets,
expense writes, invoice creation or customer messaging. See
[dump expenses](dump-expenses.md) and [truck load status](truck-load-status.md)
for downstream source precedence and actual-expense reconciliation.

Validation: `npm run verify:visit-tracking-agent`,
`npm run verify:geofence-alerts`, `npm run verify:appointment-visit-alerts`.

## Coordinate reconciliation and separate visit segments

When positive facility reports have matching timestamped GPS coordinates, the
tracking agent can also establish departure from two later fixes more than five
kilometres from that observed facility position, at least one minute apart, with
no gap greater than five minutes between corroborating fixes. Positive same-site
membership takes precedence over this conservative geometric fallback. A later
return starts another facility episode; intervening coordinates never create an
arrival, unload or expense. This handles repeated dump visits separated by job
visits even when the native alert feed is unavailable.

For an already-confirmed appointment, the shared reader uses verified service
coordinates and two later GPS fixes beyond twice the normal site radius, at least
one minute apart. It bounds the departure without changing the collector's raw
intervals or physical-closeout truck attribution. Command and Schedule consume
that shared projection. A lone fix, boundary jitter, unknown/ambiguous address,
wrong truck or future timestamp cannot establish departure.

Each appointment interval's reconciliation stops before the next recorded
interval starts. If a prior interval has no proven departure, it is shown as
**Earlier GPS segment; departure time unavailable**, rather than an active
arrival awaiting departure. A later segment does not prove continuous presence
through a gap, and no exact onsite duration is created from inferred bounds.
Source-confirmed zero-duration visits remain closed observations.

Additional validation: `node --import tsx scripts/test-appointment-position-tracking.ts`.

## Visits independent of booking time

The visit runner matches every recorded GPS point on the selected Central
operating day, regardless of the appointment window or source completion status.
One point inside the existing 200-meter verified premises boundary establishes a
visit. There is no minimum dwell, minimum visit duration, maximum visit duration,
or before/after-booking cutoff. Exact source appointment and truck identities,
verified coordinates, linked-record reconciliation and duplicate checks remain.

The application-owned wrapper applies this policy to the installed collector
in memory; incompatible collector source changes fail its checked anchors.
The source collector file, provider polling and original bookings remain intact.
The next existing collector run uses the policy after an approved release.
Schedule's immediate presence projection follows the same rule. Its freshness
limits describe whether a report is current, not whether the visit occurred.
A single-point visit remains visible as **GPS** with duration unavailable;
recorded arrival/departure and gaps determine available duration separately.

Validate with `scripts/test-linxup-instant-arrivals.py` against the installed
matcher, the Schedule presence/visit/block tests, and a read-only daily replay
with output writers disabled before release.

## Assign unassigned appointments from GPS visits

For today's unassigned appointments, one uniquely identified visiting truck is
the operational truck immediately, including a single recorded GPS point.
The existing GPS refresh and push runners launch a separate, nonblocking worker
to save that truck in JunkWare. The worker preserves the source booking window,
status, payments and closeout, and publishes the saved assignment only after
JunkWare read-back. Completed appointments remain eligible; canceled records,
multiple visiting trucks, missing verified locations and pending changes require
review. Existing physical assignments are never automatically overwritten.

The worker uses existing appointment/source locks and durable Schedule receipts.
One appointment/day receives one automatic decision; repeat GPS reports,
process restarts and later manual unassignment do not replay it. An uncertain
write requires source reconciliation. The source appointment and dispatch lane
are checked again before submission to avoid overwriting a newer assignment.
The worker has its own process lock and does not inherit the GPS ingestion lock.
Verified write receipts bridge collection lag only. A later observation of that
appointment in JunkWare supersedes the saved truck and booking window. The board
still shows the physical GPS visit on its visiting truck, with the current
JunkWare assignment shown separately when it differs. A later unassignment does
not replay the original automatic write. Pending changes retain their explicit
reconciliation state; unknown, future or older source observations cannot erase
a verified move.
Validate with `npm run verify:gps-visit-assignment`.
