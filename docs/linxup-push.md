# LinxUp live GPS push

LinxUp V3 Position Push posts directly to the protected OpsCenter receiver:

```text
https://hooks.junk-king.app/api/integrations/linxup/push
```

The public `hooks` hostname exposes only signed ingestion routes. The receiver
requires the exact bearer token configured in `LINXUP_PUSH_BEARER_TOKEN`, stores
the raw V3 event in the private OpsBot data directory, normalizes the GPS point
against the effective vehicle map, recomputes the current appointment visit, and
publishes a newly confirmed truck-arrival Slack alert before returning success.

Configure the V3 **Position URL** to the endpoint above and set the same bearer
token in LinxUp and the Mission Control Keychain item
`com.opscenter.linxup-push-bearer-token`. Do not put either token in Git, Slack,
or a Business bundle.

V3 Position Push is the authoritative live source whenever a current push is
present. The V2 minute collector remains enabled as a verification, backfill,
and automatic fallback path. A current V3 point wins over a newer polled point;
if no V3 point has arrived within the configured authority window, OpsCenter
uses the newest V2 point and explicitly reports `v2_poll_fallback` rather than
presenting the fallback as authoritative live push data.

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
