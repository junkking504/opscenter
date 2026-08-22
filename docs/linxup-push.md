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
or a Business bundle. The V2 minute collector remains only as a
rollback/backfill mechanism until a real V3 position is received and verified;
then disable `com.openclaw.opsbot.linxup-collector`.

This removes OpsCenter's polling delay. The timestamp remains the tracker’s
reported `positionDate`, and confirmed job arrivals still require the existing
two-point, two-minute, 125-meter dwell evidence rule.

Push processing and the V2 fallback poller use the same self-healing lock. The
lock records its PID and start time, ignores only a live owner within the
configured maximum runtime, and automatically replaces an abandoned or over-age
lock. The owner token also prevents a timed-out process from removing a newer
processor's lock when it eventually exits.

Mission Control currently runs the fallback poller as a per-user LaunchAgent and
reads its V2 token from the `missioncontrol` login Keychain. The console may be
locked, but that user must remain logged in; logging out removes the GUI launchd
domain and its collector. This is an accepted single point of failure until the
collector and secret are migrated to a headless service context.
