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
