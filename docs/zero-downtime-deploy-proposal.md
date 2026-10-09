# Proposal: keep the old web process serving during release activation

**Proposal only. No controller, launchd, tunnel or runtime configuration changed.**
Requires T’Jean's approval before implementation and a separate reviewed install
of the externally managed controller. No paid service or additional host is
proposed. The normal forward-only `origin/production` and spending gates remain.

## Current failure and constraints

The current controller builds an immutable directory, switches `opscenter`, then
`launchctl kickstart -k`s `com.openclaw.opscenter` and waits for `/login`. There is
no listener while Next starts. The reported cloudflared origin-error clusters
at 15:20Z, 15:57–15:58Z and 16:08Z match that sequence; this is separate from
build time. `/api/health` already checks database identity, local state and source
freshness, while operational warnings such as a silent truck are deliberately
separate from its liveness status.

`scripts/run_opscenter.sh` hardcodes `/tmp/com.openclaw.opscenter.lock`: simply
starting another process on another port currently fails. The existing plist
also resolves working directory and app path through the mutable live symlink.
Both must change in a reviewed slot launcher; new slots must use absolute
immutable release paths and separate process locks.

## Proposed steady-state layout

```text
Mac cloudflared ────────────────┐
VPS SSH origin relay ───────────┼─> stable loopback proxy :3000
Local probes/clients ───────────┘       │ active generation
                                      ├─ slot A :3201 → releases/<old SHA>
                                      └─ slot B :3202 → releases/<new SHA>
```

Keep 3000 as the public/local contract. Preview remains 3100. Before installation,
verify that 3201/3202 are free and unreserved. The stable proxy and its launchd
entry live outside releases, under deployment-control; app deploys do not restart
it or cloudflared. Use the existing Node runtime and built-in HTTP facilities,
with no new package or service provider. Only loopback ports are exposed.

Two launchd labels, `com.openclaw.opscenter.slot-a` and `.slot-b`, each invoke a
stable launcher reading a root-of-deployment, owner-only slot manifest. The
manifest pins the absolute release path, SHA and port. KeepAlive restarts the
same pinned slot, never whichever release the symlink happens to name. Slot
locks are independent, owned and validated; the deployment lock remains global.
All collectors remain singletons and outside slot startup. Warming a web slot
must not start another collector or run an external business action.

## Activation transaction

1. Acquire the existing `.deploy-lock`, keep it through build, warmup, switch,
   service verification and receipt/retention. Preserve owner diagnostics and
   never steal a live lock. Validate origin/production and active ancestry both
   before and after the build, exactly as today.
2. Run the existing installed spending gate and normal immutable build. Require
   backward-compatible, expand/contract database and file changes during overlap.
   A destructive migration is excluded from this path and needs a separate plan.
3. Pin and start the inactive slot. Probe it directly until `/api/health` returns
   HTTP 200 and `ok:true`, runtime MISSION_CONTROL, healthy expected production
   database/migration, writable operator state and expected release SHA. Add SHA
   to health from `.opscenter-release`; do not infer it from a symlink. Also check
   `/login` and the desktop asset manifest. Require three consecutive successes
   over 10 seconds, with a bounded two-minute startup deadline. Shared source
   staleness can prevent readiness; do not waive it or stop the healthy old slot.
   Operational warning counters alone must not fail activation.
4. Recheck lineage and record the previous slot. Atomically replace a small
   active-generation manifest and ask the stable proxy to validate/acknowledge
   that generation through an owner-only Unix control socket. Invalid/missing
   manifests preserve the last known good in-memory target. Proxy startup fails
   closed unless it can independently validate a ready pinned slot. Do not expose
   switching through an unauthenticated HTTP endpoint.
5. Direct **new HTTP requests** to the new slot, including requests on existing
   client keepalive connections. Already submitted requests stay on the old
   upstream. Never retry a request after submission; webhook/payment/assignment
   uncertainty remains uncertain. Support streaming/backpressure, uploads and
   upgrades without buffering entire bodies or dropping authentication/Host/
   forwarded headers. Strip hop-by-hop headers correctly.
6. Atomically update the live symlink for source consumers, restart the existing
   release-bound singleton services through the current bounded logic, and run
   local/public health plus authenticated read-only acceptance. Do not overlap
   collector instances. Retain the WhatsApp opt-out contract.
7. Keep the old slot available through a five-minute observation/rollback window.
   Drain in-flight requests before shutting it down; use the documented maximum
   request lifetime, and explicitly handle long-lived SSE/WebSocket clients.
   If a write is still in flight at the bound, defer slot retirement instead of
   killing it to meet a timer. A subsequent deployment waits for a safe free slot.
   Retention protects active, previous and all referenced release paths, including
   both slot manifests and open processes. Record SHA, generation, timings and
   failures in the existing deployment history.

Old open pages may request lazy chunks after a switch. Preserve content-hashed
`/_next/static/` and desktop asset files for retained releases. The stable proxy
may look up a missing **immutable static GET** in retained manifests; never fall
back for APIs, authentication, HTML or writes, and never traverse an unvalidated
path. Prefer a release-qualified asset URL if current manifests cannot resolve
this safely. Test old tabs and unsaved drafts before acceptance.

## Rollback and crash recovery

A failure before traffic switch stops only the candidate; old traffic and the
live symlink remain intact. A failure after switch but before acceptance
atomically returns the proxy to the still-running previous generation and
restores the symlink and singleton services through the controller's automatic
failure recovery. It does not rewind origin/production. Manual rollback remains
separately authorized, as today. No data rollback or automatic request replay.

Persist transaction phases so a controller crash between manifest, proxy ack and
symlink changes can reconcile under the lock using verified slot SHA/readiness.
The proxy should keep serving its last healthy acknowledged generation during
that reconciliation. If both slots fail, fail closed; do not silently promote
VPS writes. A proxy crash is still an availability risk, and a host failure is
outside the zero-gap application-deploy guarantee.

## VPS and port 3000 compatibility

The VPS origin relay continues to reach Mac :3000; the standby gateway's primary
probe currently checks `/login` through that relay with an eight-second timeout.
Keep the relay destination stable. Add a lightweight readiness contract based
on structured health and release identity while preserving the gateway's bounded
probe/cache semantics. Verify normal switching does not enter recovery mode.
Do not treat stale business warnings as evidence that the primary is dead.

The VPS read-only app, gateway :3002, independent app :3001, 60-second monitor,
restore process and denial of operational writes stay independent. Validate the
monitor's primary relay/readiness and release evidence after a switch. A Mac
application deploy does not update standby code; parity still requires the
separate documented standby build/acceptance process. Nothing here changes its
egress controls, reader role or single-writer policy.

Existing preview isolation/coexistence probes using :3000 should continue to see
production through the proxy. Inventory all local collectors, relay launchers,
health checks and public hostnames before bootstrap; do not repoint only one
hostname and assume every path was moved.

## Exact source and installed surfaces for a future implementation

| Source path | Proposed change |
| --- | --- |
| `deploy/macmini/deploy-release.sh` | Slot preparation, warmup, atomic switch, drain, automatic failure recovery and receipts |
| `deploy/macmini/install-production-release-controller-from-macbook.sh` | Explicit reviewed installation of proxy/slot control alongside controller, preserving spending gate |
| `deploy/macmini/production-launchd/com.openclaw.opscenter.plist` | Document migration/retirement of the old single-process service |
| New `deploy/macmini/production-launchd/com.openclaw.opscenter.slot-a.plist`, `.slot-b.plist`, `com.openclaw.opscenter.origin-proxy.plist` | Independent pinned app slots and stable listener |
| New `deploy/macmini/origin-proxy.mjs`, `run-release-slot.sh` | Atomic per-request routing/control and separate slot locks |
| `scripts/run_opscenter.sh` | Preserve default path while supporting an explicitly scoped lock if reused by slots |
| `app/api/health/route.ts` | Immutable served SHA/readiness identity |
| `deploy/macmini/workspace-retention.py` | Protect both live slot manifests and drain/rollback references |
| `deploy/vps/continuity-proxy.mjs`, `continuity-monitor.py` | Structured primary readiness and served-release checks; unchanged write restrictions |
| `scripts/test-continuity-proxy.mjs`, new `scripts/test-release-cutover.mjs` | Readiness, loss, streaming, no-replay, crash/rollback and old-asset regression coverage |
| `deploy/macmini/verify-coexistence.sh`, `verify-kernel-isolation.py` | Verify stable :3000 plus candidate identity without confusing preview |
| `deploy/macmini/README.md`, `docs/server-continuity.md`, `docs/workspace-retention.md` | Bootstrap, routine activation, failure and retention runbooks |

Installed changes would be limited to reviewed deployment-control files, slot
manifests/control socket and the corresponding `~/Library/LaunchAgents` plists.
Protected environment, credentials and spending approval files are reused,
never copied into Git or changed. Installed paths are a future approval boundary.

## First migration and acceptance

The currently running app owns :3000, so the stable proxy cannot bind it yet.
A zero-gap promise cannot cover this first port-ownership migration without an
additional verified routing bridge. Plan a separately approved, bounded initial
maintenance cutover to establish the proxy, or design/test that bridge first.
Routine releases after that bootstrap should have no listener gap.

Before production approval, run isolated sustained traffic through a test proxy:
healthy/failed/slow candidates, concurrent deployments, crash at each phase,
missing assets, old-tab lazy loads, streaming/long uploads, aborted response after
a write, collector restart failure and proxy restart. Require zero refused/reset
requests during ordinary cutover and exactly one submission for writes. Then
observe public ingress and VPS relay independently during one authorized release;
absence of local login failures alone is insufficient. No synthetic writes to
live financial or operational systems.
