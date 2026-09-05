# Operational readiness

`/api/health` remains the core availability and source-freshness signal for daily metrics, JunkWare, LinxUp, writable state, and the platform kernel.

`/api/readiness` is the stricter operator gate. It returns HTTP 200 only when all of the following are ready:

- OpsCenter authentication has an identity, password hash, and non-default session secret configured.
- All five WhatsApp photo queue directories are readable, and the queue has no incoming, processing, review, or failed records. Review and failed counts are returned with safe reason totals so unresolved photos are visible without exposing sender, customer, or media data.
- The latest Crew Portal Cloudflare KV synchronization wrote a read-back-verified `synchronized` status record within the last 20 minutes. Missing, malformed, or future timestamps cannot establish readiness.

The Crew Portal sync writes its durable status to `OPSBOT_DATA_DIR/integrations/crew-portal-sync/status.json` through the active release data path. A failure retains the last successful publication time alongside the current error category and attempt time. Network and rate-limit upload failures retry the identical payload up to three times. Successful uploads receive up to five bounded read-back attempts to allow KV propagation; authentication failures stop immediately. Raw payloads, credentials, and CLI output are never included in the status record.

Command Source Health and Monitor include JunkWare, LinxUp, QuickBooks (authorized roles), SearchKings, Podium, Crew Portal, and WhatsApp photos. Command also reports Slack and its action service. Photo status includes reason counts and the number of unresolved queue records last modified over 24 hours ago. These are operational decisions, not permission to assign photos to guessed senders or jobs.

Session rejection diagnostics are structured application-log entries. They include only the rejection reason, request kind, host, method, trusted-device state, and Cloudflare request ID. Cookies, session values, identity, customer data, and query strings are never logged.
