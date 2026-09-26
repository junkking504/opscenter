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

Appointment visits require the existing collector's confirmed appointment/truck
attribution and reject pass-bys. Separate return intervals remain separate visits.
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
