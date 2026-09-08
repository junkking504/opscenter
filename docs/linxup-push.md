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

The authoritative push path removes OpsCenter's polling delay. The timestamp remains the tracker’s
reported `date`, and confirmed job arrivals still require the existing
two-point, two-minute, 125-meter dwell evidence rule. A historical appointment
visit, or a later isolated GPS point at the same address, must never be shown
as a current on-site state; Schedule labels it only after fresh, continuous
dwell evidence is present.

## Recorded daily GPS routes

Schedule and the Command map offer a **Truck GPS route** selector. Selecting a
truck row or current truck pin uses the same selection. Clicking a truck centers the map on
its latest available GPS marker at street level. Repeated clicks recenter it. The
recorded trail stays visible, but arriving history never zooms away from the truck.
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
raw history remains unchanged. Blue dots and truck/appointment pins retain their
exact source coordinates at every zoom level.

Street geometry comes from Google Roads with interpolation. Solid lines require
consecutive matched observations, no missing original index, nearby snapped
endpoints, and no interpolation step over 300 meters. Sparse connections are
dashed and explicitly estimated. When Roads cannot interpolate an eligible pair,
Google Routes may supply an estimated driving connection. Neither source proves
which roads were driven during missing telemetry. Outages over thirty minutes
and implausible transitions remain disconnected; missing provider geometry never
falls back to a straight chord. The summary reports unmatched connections.

The authenticated `GET /api/desktop/schedule/gps/streets` reads the same source
and requires its version from the GPS response, preventing a different source
revision from being overlaid. The browser requests matching only when the source
version changes and discards obsolete responses. Provider work is bounded to 20
Roads batches and 40 route estimates, with four concurrent requests and a time
budget; omitted segments stay visibly unmatched. Only simultaneous matching
requests are deduplicated. Completed road geometry is held by the active browser
view, never written to telemetry or persisted in a server cache.

Schedule and Command use Google Map Tiles underneath Google-derived geometry.
Authenticated `/api/desktop/map` requests validate tile coordinates and viewport
bounds and proxy fixed Google endpoints through approved IPv4 egress. The
existing `GOOGLE_MAPS_API_KEY` remains server-only and IP restricted; its allowlist
includes Roads and Map Tiles alongside existing Geocoding, Places (New), and
Routes APIs. Map session tokens are reused until their provider expiry; tile
content is not persisted or prefetched. Google Maps text attribution and the
escaped provider copyright for the current viewport are displayed. Failed map
requests show an unavailable message and retry; Google geometry is never placed
on a non-Google fallback basemap.

Implementation: `lib/desktop-gps-route.ts`,
`desktop-ui/schedule-gps-route.tsx`, and `desktop-ui/schedule-map.tsx`.
Run `node --import tsx scripts/test-desktop-street-route.ts` for road matching,
unmatched gaps, estimated fallback, source versions and proxy bounds.
Run `node --import tsx scripts/test-desktop-gps-route.ts` for date, truck,
privacy, gap, stationary coverage, and missing-file contracts. The synthetic
browser fixture at `desktop-ui/tests/gps-route.html` runs the production Leaflet
component without operational API access; start it with the companion Vite config.

## Appointment arrival and departure alerts

Command derives appointment visit alerts directly from confirmed visit intervals,
even when no Slack report was published. Arrival creates one **Geofence** alert with a pending departure; confirmed
departure updates the same identity, showing `Geofence - Truck - Location` and
`Onsite: duration | arrival - departure` with local times such as `1:37pm`. Each return visit stays separate, excluding
time away. The recorded truck remains independent of the current assignment.
Job closeout remains a separate JunkWare event.

Uniquely matched older Slack arrival/departure reports remain review aliases.
Pass-bys, unconfirmed matches, future timestamps, and unsegmented multiple visits
cannot create completed visit durations. Conflicting departure records remain
pending verification. Operational confirmations with GPS gaps are identified as
such and never produce a precise duration. Validate with
`npm run verify:appointment-visit-alerts` and `npm run verify:crew-progress`.
