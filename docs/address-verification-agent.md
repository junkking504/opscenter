# Address verification agent

`address-verification` has one responsibility: resolve appointment service
locations and retain the evidence. It never edits JunkWare appointments,
assignments, payments, expenses, or sends messages. It makes no AI requests.

The independent LaunchAgent `com.openclaw.opscenter.address-verification` runs
once a minute through the active immutable release. A dedicated inherited OS
lock prevents duplicate work, including calls from the existing GPS refresh.
A 90-second deadline bounds each run. GPS network failures and an unopened UI
cannot prevent this agent from running. Install after release activation with
`deploy/macmini/install-address-verification-agent.sh`.

The worklist covers the operating day, collected future dates, and the previous
seven days, including completed appointments. At most two ordinary address
checks run per tick, rotating fairly. Failed lookups wait six hours; newly
confirmed native-stop evidence bypasses that wait. Existing Census/OSM and
reviewed locations retain precedence. A failed research attempt does not trigger
another paid call.

## Exact-address stop recovery

When the visit collector has no verified geocode, its release-owned wrapper can
recover a visit from already collected LinxUp native stops. It requires exact
house/street/city/ZIP, the effective assigned tracker, one eligible appointment,
a qualifying stationary stop, corroborating GPS positions and a five-minute
minimum dwell. Numeric business labels are preserved; multiple street candidates,
unit-specific premises, different trucks and competing appointments are rejected.
Native engine-off and adjacent idling phases join only when continuous. Duplicate
provider rows count once. Separate returns remain separate intervals. Departure
still requires sustained later outside positions; completion status cannot supply
a departure time. Stop-derived location evidence does not become a permanent
verified map pin by itself.

## Parcel corroboration

The first official parcel adapter supports St. Tammany Parish. It runs only after
ordinary verification fails and an exact-address assigned-truck stop is confirmed.
The public 2025 parish parcel endpoint must return exactly one matching street
address and a small single polygon. Its interior location must lie within 75
metres of the independent stop; city and ZIP must match that stop. Duplicate,
large, multipart or conflicting parcels remain unresolved. Other parishes retain
the existing verifiers until their own reviewed adapters are added.

This endpoint has no credentials or usage charges. Requests have an eight-second
timeout, no redirects, a two-feature limit, at most two requests per run and a
hard cap of 100 per Chicago day. Reservations are saved before each request.
A damaged request ledger blocks calls. The separately installed service-host
allowlist requires explicit approval of `maps.stpgov.org`; deployment must not
bypass that gate or modify existing paid-service controls.

## Persistence and downstream recovery

State lives in `data/addresses/agent/state.json`: heartbeat, last successful run,
per-address status/reason, attempt timestamps, source and daily request count.
Verified reviews remain in the existing `cache/service-address-reviews` store.
The appointment geocode cache is published through the shared OS-locked
compare-and-merge transaction so concurrent source writers cannot lose updates.

Each new correction creates a durable replay intent before cache publication.
The visit workflow waits for that exact correction, rematches the affected date,
validates the result, then acknowledges only the requests it consumed. Requests
survive failures and concurrent new corrections. At most three dates replay per
GPS tick, using existing local history, including completed jobs. No historical
Slack notifications are sent by replay. Normal current-source alert behavior is
unchanged.

Validation: `npm run verify:address-agent`, `verify:service-addresses`, the geocode
transaction tests, TypeScript checks, immutable production build, an independent
worker heartbeat, and authenticated Command/Schedule card read-back.
