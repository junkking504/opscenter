# Operational readiness

`/api/health` remains the core availability and source-freshness signal for daily metrics, JunkWare, LinxUp, writable state, and the platform kernel.

`/api/readiness` is the stricter operator gate. It returns HTTP 200 only when all of the following are ready:

- OpsCenter authentication has an identity, password hash, and non-default session secret configured.
- The WhatsApp photo queue has no incoming, processing, review, or failed records. Review and failed counts are returned with safe reason totals so unresolved photos are visible without exposing sender, customer, or media data.
- The latest Crew Portal Cloudflare KV synchronization wrote a verified `synchronized` status record.

The Crew Portal sync writes its durable status to `OPSBOT_DATA_DIR/integrations/crew-portal-sync/status.json` through the active release data path. A failure retains the error category and attempt time; a later verified sync replaces it with the success timestamp.

Session rejection diagnostics are structured application-log entries. They include only the rejection reason, request kind, host, method, trusted-device state, and Cloudflare request ID. Cookies, session values, identity, customer data, and query strings are never logged.
