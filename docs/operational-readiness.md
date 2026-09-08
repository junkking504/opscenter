# Operational readiness

`/api/health` remains the core availability and source-freshness signal for daily metrics, JunkWare, LinxUp, writable state, and the platform kernel.

`/api/readiness` is the stricter operator gate. It returns HTTP 200 only when all of the following are ready:

- OpsCenter authentication has an identity, password hash, and non-default session secret configured.
- All five WhatsApp photo queue directories are readable, and the queue has no incoming, processing, review, or failed records. Review and failed counts are returned with safe reason totals so unresolved photos are visible without exposing sender, customer, or media data.
- The latest Crew Portal Cloudflare KV synchronization wrote a read-back-verified `synchronized` status record within the last 20 minutes. Missing, malformed, or future timestamps cannot establish readiness.

The Crew Portal sync writes its durable status to `OPSBOT_DATA_DIR/integrations/crew-portal-sync/status.json` through the active release data path. A failure retains the last successful publication time alongside the current error category and attempt time. Network and rate-limit upload failures retry the identical payload up to three times. Successful uploads receive up to five bounded read-back attempts to allow KV propagation; authentication failures stop immediately. Raw payloads, credentials, and CLI output are never included in the status record.

Command Source Health and Monitor include JunkWare, LinxUp, QuickBooks (authorized roles), SearchKings, Podium, Crew Portal, and WhatsApp photos. Command also reports Slack and its action service. Photo status includes reason counts and the number of unresolved queue records last modified over 24 hours ago. These are operational decisions, not permission to assign photos to guessed senders or jobs.

Session rejection diagnostics are structured application-log entries. They include only the rejection reason, request kind, host, method, trusted-device state, and Cloudflare request ID. Cookies, session values, identity, customer data, and query strings are never logged.

## Operational signals and liveness

`/api/health` keeps its deploy-gate and container-liveness contract. Operational
problems appear in its informational `signals` and `operationalStatus` fields;
they do not change its HTTP status. Authenticated `/api/operational-status`
returns HTTP 503 with a populated `blocking` array for critical operational
signals. Warnings return HTTP 200 with a non-OK operational verdict. The legacy
status chip includes these signals and reads **Attention Required** for criticals.

Signals include payroll exceptions, mapped tracker silence, delegated arrival
coverage, geocoding, integration queues, storage, and backup freshness. Unassigned
appointments are excluded from the arrival denominator. Aggregate signals are
cached for 30 seconds per date and data source; `OPSCENTER_SIGNAL_CACHE_MS=0`
disables that cache. GPS-file parsing is cached by resolved path and mtime.

The new tracker and payroll incident kinds use the existing Slack incident
lifecycle. Tracker incidents are suppressed for trucks already reported out of
service. Preview verification must not invoke a live publisher.

## Sign-in and repair retries

Operator and crew login counters persist in `data/auth/login-attempts.json`
(or `OPSCENTER_LOGIN_RATE_LIMIT_FILE`). Eight failures in the 15-minute window
lock the address and address/identity pair for 15 minutes. Updates serialize
across processes, recover dead-owner locks, and prune against the caller's clock.
Unreadable state blocks sign-in; failed writes abort authentication. Investigate
storage and restore valid state rather than resetting the limiter automatically.
Identifiers are hashed, not salted. The default trusted-device duration is 30
days, including validation of previously issued longer-lived cookies.

Manual Fleet repair forms send a stable submission ID when retrying the same
unchanged draft. The server returns the existing result within five minutes
without undoing subsequent edits. Distinct submissions remain distinct even with
identical text. Clients without a submission ID are not deduplicated by guesswork;
the desktop action flow retains its own request-ID handling.

## Map and browser policy checks

Legacy `/jobs` and `/fleet` OSM basemaps upscale z19 tiles through display zoom
20 and retain a warning while any failed tile remains visible. The current
`/desktop` Schedule has a separate Google map implementation and requires its
own maximum-zoom browser check. Keep truck detail and schedule interactions in
that acceptance check.

CSP ships as `Content-Security-Policy-Report-Only`. Collect browser violations
before enabling `OPS_CSP_ENFORCE`; map embeds, third-party imagery, and HLS hosts
must be accounted for. `OPS_CSP_EXTRA_CONNECT_SRC` and
`OPS_CSP_EXTRA_MEDIA_SRC` extend their respective directives. No reporting
collector is installed by this change.

Operational log/receipt pruning is separate from workspace/release retention.
Adding its script or plist does not authorize running it or installing its job.
