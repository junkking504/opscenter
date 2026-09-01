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

## Governed device review

OpsBot Control shows LinxUp at the device level through
`/api/platform/linxup?date=YYYY-MM-DD`. The overall collector or Fleet snapshot can be
fresh while an individual tracker is stale, missing a coordinate, using V2 fallback, or
unmapped. Collector health is therefore displayed separately and its collection
timestamp is never substituted for a device position timestamp. A truck with no actual
device point is `GPS unavailable`, not `Live GPS`.

`linxup.record_device_review.v1` is the only write in the first LinxUp control pack. It
records one of four bounded internal dispositions: monitor, provider follow-up, mapping
follow-up, or human-confirmed no issue. It is risk class 2, requires approval from a
different manager or administrator, and checks the exact device observation plus the
current review-store and record versions before execution. The saved review and its audit
event are then read back for verification.

This review action does not rewrite GPS history, change the effective vehicle map,
contact LinxUp, or alter a truck's Fleet availability. In preview it returns a verified
simulation receipt and does not write the shared review store.
