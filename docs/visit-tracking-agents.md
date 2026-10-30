# Visit tracking and unload agents

## Five-minute geofence minimum

Every named geofence alerts immediately when its native entry or first positive
GPS facility report becomes available through the existing refresh cadence.
The alert is provisional until evidence supports at least 300 seconds onsite.
At five minutes, the same alert becomes confirmed. If a reliable native entry
and departure establish an interval shorter than five minutes, its provisional card is removed from the operational record and
it contributes no GPS visit, unload or assumed dump cost. An inferred departure
can prove a short stay only when its upper bound is under five minutes from a
reliable native entry. A short GPS-only lower bound is insufficient for deletion;
closed uncertain episodes remain flagged for review and excluded from counts.
Raw provider evidence remains available for audit. A missing feed alone never proves departure.

Slack follows the same lifecycle: entry posts immediately with a pending label,
confirmation updates that message, and a proven short episode retracts
its bot-owned message using the saved channel and message receipt. Failed
retractions retain their receipt for retry by the existing runner. Legacy
messages without receipts cannot be safely deleted by guessing identity.
A notification already displayed on a phone cannot be recalled from the device.
Native departures alert only for qualified visits; inferred departures retain
explicit bounds in OpsCenter. Prior/next-day context retracts short midnight
crossings from both the prior-day card and the owned Slack message.

Native entry/exit pairs can prove the interval; ongoing GPS membership must form
a continuous sequence with gaps no greater than five minutes. Wall-clock age,
missing exits, ambiguous repeated entries and inferred departure upper bounds do
not establish dwell. Once a continuous five-minute interval is established, a
later conflicting exit or repeated entry retains that qualification and its
arrival anchor. The conflict remains visible in the review card and notification;
it cannot authorize deletion or silently remove a visit, unload or assumed cost.
Inferred departures qualify only from the observed onsite lower bound. Each evidenced departure and return qualifies separately; a gap
alone cannot establish an exit and new visit. Once qualified, an unload retains
the first qualifying continuous presence anchor so later pickups are preserved;
an earlier isolated sighting across a GPS gap cannot backdate that unload.
Recorded actual dump expenses remain independent evidence. This policy applies
to named geofences; appointment visit-pin matching retains its separate policy.
The Schedule HQ fallback also requires five minutes from trip arrival/departure
evidence or continuous onsite fixes; a route coverage timestamp is not dwell.

The reader separates `alertEntries`/`arrivals` from qualified
`trackedVisits`/`visits`; uncertain closed episodes live separately in
`reviewVisits`. EMR GPS reconciliation must use qualified `trackedVisits` or
`visits`, never raw entries, review-only episodes or provisional alerts. A receipt is independent evidence of a delivery;
a short crossing cannot create an expected receipt or erase a recorded one.


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
close a visit. Midnight uses Chicago operating dates and previous/current/next-day context.
Every daily read replays the same available evidence and selects episodes that
intersect that day. Overnight views share one episode ID. Unload projection
attributes exactly one reset to the supported arrival day, even when the exit
after midnight supplies the first proof of five-minute presence. Departure
notifications are limited to their actual departure day.

A native exit later received within the inferred bounds replaces the inferred
exit when replayed. An exit timestamp contradicting a newer different-facility
position retains one bounded visit with a conflict flag. Distinct repeated native
entries before qualification leave arrival/duration unconfirmed; repeats after a
proven qualifying interval retain that interval with a conflict flag. Source aliases preserve reconciliation when
an earlier native arrival later supplements a V3 episode.

Appointment visits require the collector's confirmed appointment/truck
attribution. Recorded positions inside eligible verified or labeled approximate pins must qualify under the
five-minute policy below; legacy unconfirmed pass-by rows are not promoted without replay.
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

For an already-confirmed appointment, the shared reader uses the recorded visit pin (or current verified/approximate
service coordinates for legacy records) and two later GPS fixes beyond twice the normal site radius, at least
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

## Appointment proximity and five-minute visits

Appointment observations are collected across the entire Central operating day,
independent of the booking window. The matcher retains raw proximity intervals,
including single-point and short passes, in the existing ledger. Those observations
are not sufficient by themselves to establish an operational visit.

The shared `appointment-visit-qualification.ts` projection requires at least
300 seconds of supported presence in one interval. Timestamped fixes must form
a continuous run with no gap greater than five minutes or explicit coverage gap.
Separate passes are never summed. Open wall-clock age, a parked shutdown, missing
fixes and stale reports cannot establish initial dwell. Legacy confirmed closed
intervals without individual fixes retain their source timing if no coverage gap
contradicts it. Explicit operational confirmations remain independent evidence.

Schedule status, visit blocks, crew progress, tracked visits and appointment
notification preparation use this qualification. Notifications wait for supported
dwell and keep the original arrival identity; late evidence still qualifies.
Existing delivery receipts are unchanged. The raw ledger and telemetry remain
available; no historical replay, deletion or source-booking edit is required.

Source-completed appointments retain valid recorded actual timing even for a
shorter interval; source completion never promotes that short interval into a new
GPS arrival notification. Open future appointments keep their booked slot after
an earlier departed visit. An actively qualified visit may display at its actual
time. A parked location without qualified dwell is labeled GPS proximity.

The 200-meter radius, point-level ambiguity, approximate-pin activation, truck
identity, separate return episodes and source freshness rules remain unchanged.
Validate with `npm run verify:appointment-loiter`, the Schedule visit/presence,
actual-block, tracking, crew-progress and appointment/Slack alert tests. All
fixtures are offline; do not run live collectors to test the rule.

### Continuous appointment visits between GPS reports

The app-owned matcher policy keeps the original arrival until positive departure
evidence. The installed collector's five-minute gap between inside points no
longer creates a second appointment visit. An hourly parked heartbeat, ignition
cycle, or missing/stale GPS report cannot end a visit. Coverage gaps remain in
the output and mark coverage incomplete; elapsed visit time does not assert
continuous GPS sampling. Schedule's current-position freshness remains separate.

Departure retains the existing conservative rule: at least two distinct fixes
beyond twice the site radius, at least one minute apart, with no gap over five
minutes between corroborating fixes and at least the configured departure grace
since the last inside point. Boundary jitter and conflicting same-time positions
interrupt corroboration. A later inside report after that confirmed departure
starts a genuine return visit; time away remains excluded. The endpoint remains
the last recorded inside fix, not the wall clock or an invented exact exit.

This policy is applied by the existing wrapper on ordinary collection after an
approved release. It does not modify the external collector source, raw GPS,
appointment bookings, historical closeouts, expenses, or existing notification
receipts. It does not replay earlier dates. Existing Chicago operating-day
isolation, appointment pin ambiguity/identity and per-truck matching stay intact.
Legacy already-split records remain subject to the reader's conservative segment
handling until a separately authorized recomputation; do not blindly merge all
displayed bars or delete old arrival alerts.

Validate with `scripts/test-linxup-continuous-visits.py`,
`scripts/test-linxup-instant-arrivals.py`, `scripts/test-approximate-arrivals.py`
and the existing appointment tracking and Schedule tests. All matcher fixtures
use synthetic records and disabled live writers.

## Assign unassigned appointments from GPS visits

For today's unassigned appointments, one uniquely identified visiting truck is
the operational truck immediately, after a qualified five-minute GPS visit.
The existing GPS refresh and push runners launch a separate, nonblocking worker
to save that truck in JunkWare. The worker preserves the source booking window,
status, payments and closeout, and publishes the saved assignment only after
JunkWare read-back. Completed appointments remain eligible; canceled records,
multiple visiting trucks, approximate visit evidence, missing verified locations and pending changes require
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

### Nearby appointment circles

Appointment ambiguity is evaluated at each recorded GPS position. A position
inside exactly one non-canceled appointment's 200-meter circle can establish
that visit even when another circle overlaps elsewhere. A point shared by two
circles establishes neither arrival and does not extend attributed onsite time
or prove departure. Completed appointments still compete; booked time, truck
assignment and verified/approximate labels do not resolve physical ambiguity.
Schedule uses the same point-level test for current presence, parked location
and open visit badges. Its arrival fallback cannot backdate through ambiguous
approach points. Freshness, source precedence, prospective approximate-pin
activation and conservative departure evidence remain unchanged.

Validate with `npm run verify:approximate-visits` and
`node --import tsx scripts/test-schedule-gps-presence.ts`.
