# LinxUp live GPS push

LinxUp V3 Position Push posts directly to the protected OpsCenter receiver:

```text
https://hooks.junk-king.app/api/integrations/linxup/push
```

The public `hooks` hostname exposes only signed ingestion routes. The receiver
requires the exact bearer token configured in `LINXUP_PUSH_BEARER_TOKEN`, stores
the raw V3 event in a private durable queue before returning success. The response
distinguishes `queued: true` from `processed: false`. Invalid/unmapped events are
rejected before acknowledgement; storage failures return a retryable error.
After the response, a processor takes the shared GPS lock, normalizes queued
points against the effective vehicle map, recomputes appointment visits, and
publishes newly confirmed truck-arrival alerts. A busy lock leaves entries queued,
not rejected. The existing minute collector drains pending entries before network
work and after polling, providing recovery after a server restart. Failed entries
remain queued and do not block other trucks. Raw audit records retain the original
receipt time; provider timestamps are never advanced to make a position look fresh.
Queue files are mode 0600, atomically published and flushed before acknowledgement;
pending capacity is bounded to 1,000 records and a drain processes up to 100.
`/api/health` exposes pending count, oldest age, and queue readability.

Configure the V3 **Position URL** to the endpoint above and set the same bearer
token in LinxUp and the Mission Control Keychain item
`com.opscenter.linxup-push-bearer-token`. Do not put either token in Git, Slack,
or a Business bundle.

V3 Position Push is the authoritative live source whenever a current push is
present. The V2 minute collector remains enabled as a verification, backfill,
and automatic fallback path. A current V3 point wins over a newer polled point;
if no V3 point has arrived within the configured authority window, OpsCenter
uses the newest valid observation across V2 and V3. A polled observation reports
`v2_poll_fallback`; a newer stale V3 observation reports `last_known`. Push-only
trucks remain visible. Invalid/future observations are excluded. The observation's
own timestamp still controls stale labels, nearest-truck eligibility, and on-site
evidence; keeping a last-known marker does not restore live GPS authority.

`/api/health` exposes `linxupDeliveryMode`, `linxupV3UpdatedAt`,
`linxupV3AgeSeconds`, and `linxupFallbackActive`. A healthy V2 snapshot with a
silent V3 receiver returns HTTP 200 as `degraded-linxup-v3-fallback`; stale V2
and V3 data remains a hard `stale-linxup-data` failure. Provider configuration
is not complete until a real (non-synthetic) LinxUp event is stored below
`data/history/linxup/push/<date>/`, appears in the normalized snapshot with
`delivery_source: v3_position_push`, and makes health report
`linxupDeliveryMode: v3_position_push`.

The official V3 Position contract names its epoch-millisecond timestamp field
`date`. The receiver normalizes that field while retaining compatibility with
the older `positionDate` spelling. Invalid, future-dated, or unmapped position
payloads return a non-success response so LinxUp retains and retries them;
OpsCenter must never acknowledge a position that it silently discards.

The authoritative push path removes OpsCenter's polling delay. The timestamp
remains the tracker's reported `date`. Initial on-site dwell qualification in Schedule and the
Command map shares `lib/gps-presence-policy.ts`: valid coordinates within
125 meters, at least two minutes of continuous source-backed dwell, and an
observation no older than three minutes. A first point cannot prove dwell.
Uncovered gaps over five minutes, a newer away point or a recorded departure
break the interval; an explicit source `continuousUntil` can cover a gap.
Ambiguous nearby appointments, unverified addresses and closed jobs cannot
create current presence. The desktop event stream still refreshes the screens
when source evidence changes. These rules supersede the earlier instant-beacon
and 75-minute parked-beacon policies. They do not replay historical notifications.


Both push and minute reconciliation run `match-linxup-instant-arrivals.py`:
one point, zero dwell minutes, with existing verified geocodes and tracker
mappings. Pre-policy visits (before September 10, 2026, 3:33 PM Chicago) keep
the former two-point/two-minute qualification so this change does not replay
earlier drive-bys as new notifications. Departure evidence remains separate.

A positive V3 `geofence.name` is also saved in a separate local observation
stream. Command announces the first facility report without waiting for the
V2 alert collector. Repeated reports do not duplicate arrivals; explicit V2
entry/exit events reconcile them. An absent geofence field never invents a
departure. Position-only facility reports do not create automatic load resets;
those remain tied to the explicit entry feed. No extra provider polling is added.
Delivery still depends on LinxUp sending the observation and network/processing
time. Facility notifications have their own event policy; they do not prove a
current appointment beacon.

Schedule retains an established on-site visit while the truck is stopped with
explicit ignition OFF and its last report is within the existing 75-minute
parked heartbeat window. The appointment, map beacon and truck-progress row show
On site while keeping the actual parked GPS time visible. Successive parked
heartbeats within 30 meters can retain earlier qualified dwell across the hourly
reporting interval; sparse heartbeats alone cannot establish a new visit.
A newer outside position, intervening movement, recorded departure,
closed appointment, or missed heartbeat prevents retained current presence.
Starting the engine at the same position does not invent departure; moving and
engine-on trucks still use the three-minute freshness limit. These Schedule
retention rules supersede the earlier parked three-minute cutoff; Command's
strict current-dwell policy remains separate. No visit duration, source timestamp,
JunkWare status, assignment, notification or ETA freshness is rewritten.


## Recorded daily GPS routes

Schedule and the Command map offer a **Truck GPS route** selector. Selecting a
truck row or current truck pin uses the same selection. Clicking a truck centers its latest GPS fix and fits all of the selected day's
recorded routes around that location. Repeated single clicks restore this overview.
Double-clicking the map truck keeps the same fix centered and zooms to street
level (19); arriving route data does not undo the precise-location view.
For a historical date with no current marker, selection focuses the day's last
recorded position. **Fit route** explicitly frames the full trail and its first and
last positions after manual zooming or panning;
background refresh does not reset the viewport. Dates, truck changes, and clearing
selection remove the previous overlay. Unassigned has no physical GPS history.

The authenticated, read-only `GET /api/desktop/schedule/gps?date=YYYY-MM-DD&truck=Truck+4`
reads `history/linxup/linxup_location_YYYY-MM-DD.json` from the configured OpsBot
data directory. It does not require daily metrics, crew clock-ins, appointment
assignments, or scheduled work. Only the requested truck's normalized positions
and collection/coverage timestamps are returned; tracker identifiers and other
raw telemetry fields are omitted. The client checks date/truck identity, polls
every 30 seconds, cancels obsolete requests, and labels retained history when a
refresh fails. Missing or malformed history is unavailable; a valid file with no
matching observations is empty. Neither state proves that a truck did not move.

Observation timestamps determine the America/Chicago operating date. Previous-day
last-known positions in a daily file do not become travel on that file's date.
Invalid coordinates, invalid/future timestamps, and duplicate positions are
excluded. Recorded stationary `continuous_until` intervals preserve coverage.
At a conflicting timestamp, a valid V3 position takes precedence over a V2 poll;
raw history remains unchanged. Isolated GPS dots and truck/appointment pins retain their
exact source coordinates at every zoom level.

Schedule and Command use OpenStreetMap tiles, with OpenStreetMap attribution.
Native tiles stop at zoom 19 and are enlarged at zoom 20 so close inspection
never requests nonexistent tiles. Truck and appointment markers retain their
source coordinates. The map has no Google billing dependency.

GPS trail lines prefer OpenStreetMap road geometry through the FOSSGIS OSRM
service. The authenticated `/api/desktop/schedule/gps/streets` endpoint uses the
same truck/date/source version as the recorded GPS endpoint. Only coordinates
are sent to the provider, never truck IDs, timestamps or appointment details.
Requests are serialized at less than one per second and reused in bounded,
in-memory caches (successful geometry up to 24 hours; transport failures two
minutes). No background fleet-wide road matching runs. FOSSGIS is a public,
best-effort service; see its [usage/privacy policy](https://routing.openstreetmap.de/about.html).
The map includes OSRM/FOSSGIS attribution and a map correction link.

All trip routes use solid lines. Chronological trip numbers have distinct colors
shared by their lines, list badges, and start/stop markers. Source-edge timestamps
assign road geometry to trips, including repeat visits to the same street.
Selecting a trip isolates its geometry without changing its number or color.
When road alignment is missing, GPS fixes remain individual points; no straight
lines are drawn across unverified streets. Partial road matching retains successful
source edges and resumes beyond slow or failed batches on subsequent reads so
later trips are not starved. Successful partial slices continue after five
seconds when the viewer next polls; slices with no new geometry retain the
60-second retry cooldown. Provider requests remain serialized at the existing
rate, and repeated viewers share the same in-flight slice. Road reads return available geometry immediately while one bounded
matching slice runs per selected truck. A slow provider queue cannot hold the
browser request open until it times out; later reads receive completed sections.
Sparse connections and estimated road geometry are identified in the summary and
line tooltip. Long outages and impossible jumps stay disconnected; isolated fixes
remain dots. GPS outside recorded trips uses gray. No new routing requests or
Google services are introduced. The former `/api/desktop/map` endpoints remain
retired with HTTP 410.

Implementation: `lib/desktop-gps-route.ts`,
`desktop-ui/schedule-gps-route.tsx`, and `desktop-ui/schedule-map.tsx`.
Run `node --import tsx scripts/test-desktop-gps-route.ts` for date, truck,
privacy, gap, stationary coverage, and missing-file contracts. The synthetic
browser fixture at `desktop-ui/tests/gps-route.html` runs the production Leaflet
component without operational API access; start it with the companion Vite config.

## Appointment arrival and departure alerts

Command derives appointment visit alerts directly from confirmed visit intervals,
even when no Slack report was published. Arrival creates an **Arrival** alert; confirmed departure updates that visit to a
**Departure** alert with recorded arrival, departure, and duration. Return visits
stay separate until JunkWare confirms appointment closeout, then arrival,
departure, and duration reports fold into the job or estimate completion card.
Their source aliases preserve existing review and Control ownership. **Geofence**
alerts and their compact `Onsite` format apply to facilities only.

Uniquely matched older Slack arrival/departure reports remain review aliases.
Pass-bys, unconfirmed matches, future timestamps, and unsegmented multiple visits
cannot create completed visit durations. Conflicting departure records remain
pending verification. Operational confirmations with GPS gaps are identified as
such and never produce a precise duration. Validate with
`npm run verify:appointment-visit-alerts` and `npm run verify:crew-progress`.

## Mapping billing boundary

OpsCenter does not call Google Maps Platform APIs. Schedule and legacy road
estimates use OSRM; precise address verification uses Census, and reverse
address lookup uses OpenStreetMap. Plain Google Maps address/directions links
remain available: these links contain no account API key. Review/marketing
integrations are unrelated to this mapping boundary.

`node scripts/test-no-google-map-billing.mjs` is part of the production build
and rejects Google Maps API endpoints/SDKs in executable source. Production and
preview wrappers no longer load the Maps Keychain credential. The idempotent
`scripts/disable-opsbot-google-geocoding.py --apply` migration retires the
separate OpsBot collector's Google fallback without altering appointment data
or existing verified geocodes. Missing matches remain unavailable.

## Truck status and parked heartbeats

Schedule and Command display the observation's reported mph on truck markers
and in the selected truck details, with a ticking report age. Missing or invalid
speed remains unavailable; an observation older than three minutes is labelled
last reported speed, including parked heartbeats. Selecting a truck follows its
received GPS positions at the current zoom. Manual pan or zoom pauses following;
the Follow control resumes it. Viewing recorded trips does not follow the live
truck. Positions advance only when a real report arrives; motion is not predicted
between reports. The existing source-change stream and 15-second local snapshot
fallback are unchanged. No provider polling or reporting settings are changed.

Schedule, Command map markers and Fleet distinguish motion from report age.
A zero-speed report with explicit ignition OFF displays Parked (and the known
facility, when applicable). The hourly parked reporting cadence has a bounded
75-minute heartbeat window; reports older than three minutes are labelled
`Parked report`, never `Live GPS`. Every detail retains the provider timestamp
and report age. A missed parked heartbeat becomes stale; reports over two hours
old remain Offline. Moving or engine-on observations retain the three-minute
freshness limit. Missing speed or ignition cannot establish parked/idling, and
positive speed takes priority over a conflicting ignition flag or old yard stop.
Parked heartbeat tolerance does not extend live ETA or on-site eligibility.
Mapped trucks without observations remain listed as GPS unavailable, including
when they have no assignments. GPS inventory does not depend on daily metrics.

## Crash-safe GPS processing lock

Push processing and minute polling share `scripts/run-linxup-locked.py`. It holds
an OS file lock on `tmp/linxup_live_refresh.lock/worker.lock`, inherited by the
worker process. The directory and inode stay in place; their existence is not
proof that a processor is running. A stopped process releases its lock, while a
still-running child retains exclusivity. Each processing run has a five-minute
deadline and an isolated process group; timeout stops only that run and retains
unprocessed queue entries. Polling frequency and provider usage do not increase.

A legacy empty mkdir lock is deliberately not stolen automatically during the
transition. Confirm that no live poll/push/normalization process owns it before
removing only the empty directory. Never delete the new `worker.lock` file or
its directory to unlock processing; doing so could allow concurrent writers.
The HTTP receiver continues to accept and durably queue updates when a processor
is busy. Validate crash, child inheritance, contention, timeout and legacy
migration with `scripts/test-linxup-process-lock.py` and push-queue fixtures.

## Concurrent appointment geocode publication

The separately owned OpsBot geocoder and local seed writer both use
`geocode_cache_transaction.merge_geocode_cache`. They capture a deep copy of
their starting cache, then take one shared file lock and compare changed keys
against the latest stored values. Disjoint changes merge; a conflicting change
fails for a fresh read. Unchanged old entries cannot overwrite newer records.
Damaged cache data and attempted deletion fail closed. Publication uses a unique
temporary file, fsync and atomic replacement while holding the lock.

The reviewed migration is `scripts/install-geocode-cache-transaction.py`.
Generate its manifest with `--review PATH`, inspect it, then apply the unchanged
manifest with `--apply --review PATH`. It installs the shared helper first,
backs up the exact prior source files, rejects changed sources and does not run
collectors or rewrite business records. New writers must use this transaction;
restoring an old writer can reintroduce the race. Provider behavior is unchanged.

Reviewed per-premise evidence uses an atomic create-if-absent publication. Two
conflicting proposals cannot replace one another; a coordinate correction needs
explicit review. Both stores have independent-process conflict regression tests
under `npm run verify:address-research`.
