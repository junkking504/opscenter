# Mission Control release slots

Implementation of the approved [proposal](zero-downtime-deploy-proposal.md).
A deployment of this source alone does not install or enable the controller.
Keep installation, first migration, ordinary releases, and their receipts distinct.

## Ownership and routing

The external deployment controller owns the existing `.deploy-lock`. It still
requires the exact `origin/production` head and forward ancestry, runs the
unchanged external spending check, and builds an immutable release. In slot mode
it warms the inactive loopback app at 3201 or 3202 before changing traffic.
Each launchd job pins an absolute release and holds its own kernel process lock.
A separate Node proxy holds loopback :3000. Cloudflared and the VPS relay keep
that address; neither collector jobs nor the WhatsApp worker run per slot.

Private state is `/Users/missioncontrol/opscenter-v2/.release-slots` (0700;
JSON files 0600). Slot manifests include SHA, expected database/migration, process
instance and the immutable asset inventory. `active.json` carries a monotonically
increasing generation. The owner-only Unix control socket acknowledges activation
only after independently probing that exact pinned release. The controller waits
for three consecutive full-health/login/desktop-asset checks spanning at least ten
seconds within two minutes. It repeats lineage checks after warmup.

Each new HTTP request uses the current generation, including requests on an
existing keepalive connection. An already submitted request stays on its original
slot. Uploads and responses stream with backpressure; credentials and forwarded
headers are preserved. No request is replayed after an interrupted response.
Only inventoried hashed static GETs can fall back to retained immutable releases.
No HTML, auth, API, write or traversal path qualifies.

The activation journal records each durable phase: pin intent, prepared, warmed,
traffic intent, manifest, acknowledgement, symlink, singleton services, observation,
acceptance, retirement. Normal bounded singleton restarts and the WhatsApp opt-out
remain unchanged. Acceptance requires five minutes of slot readiness and repeated
public checks. A single public blip is recorded; three consecutive public failures
trigger rollback. Local readiness stays strict. A failure before acceptance restores proxy routing, the app symlink
and singleton owners to the pinned previous release without rewinding Git.

## Drain and crash behavior

The app exposes only SHA, random process instance, stopping state and aggregate
pending `after()` count. The native Next shutdown stops new accepts and waits for
HTTP and registered background work. Known read-only `/api/desktop/events` streams
close gracefully and reconnect. A pending upload, write or upgraded stream blocks retirement. Interrupted-result
records are distinct from proof that local work finished.
No deadline authorizes killing a write. Retirement deferred after observation also
blocks reuse of that slot by the next deployment.

Proxy restart validates the durable generation and slot readiness. Lost accounting
is marked unverified; it restores routing but does not infer old work completed.
A graceful proxy stop releases :3000 first and stays alive until submitted upstream
work and tracked background work finish. It never erases uncertain-outcome records.

Before retirement, known proxy requests must be zero and live app pending work
must be zero. The controller atomically blocks subsequent launches before sending
SIGTERM directly to the verified process. It verifies the private slot lock is
actually held, waits for the original PID to exit, and only then unloads the
guard-only launchd job. The launch block remains on retired slots. Only proven
process exit allows writing the retirement proof and clearing the
proxy's unverified-work reference. A pending-zero health sample alone does not
prove that HTTP requests lost during a proxy crash ended: native shutdown must
finish those too. A stopped or replaced process does not keep an obsolete release
pinned forever. Unknown business outcomes remain in an append-only private
`uncertain-outcomes.jsonl`: time, fixed method, fixed route group and release SHA,
no URL values, bodies, headers or personal identifiers. Retirement never deletes
that evidence. At 16 MiB the ledger reports failure and requires a separately
reviewed archival decision; this installer does not authorize data deletion.

Host testing found that `disable` alone did not suppress KeepAlive relaunch, and
`bootout` ended a live dummy immediately even with `ExitTimeOut=0`. Therefore no
deployment path uses `bootout` on a business-serving process. All three launchers
check a private fail-closed guard before secrets, locks or listeners. Expected
blocked launches are silent and throttled by launchd. The plist timeout is not
relied on as a safety guarantee. A Mac shutdown or software update still needs
separate supervised quiescence; do not use either to force deployment drainage.

The next deployment reconciles a nonterminal activation journal under the global
lock. A dead journaled owner can have its lock **renamed and preserved** only when
its recorded transaction and singleton child PIDs are also dead. Live, reused, or
unknown PIDs block recovery. A stale build lock without a matching activation
journal requires operator investigation; do not remove it or force a deploy.
Accepted journals reconcile receipts and retirement, never roll back accepted work.

The existing legacy process-recovery worker retains its old label scope. It does
not gain authority over the proxy or slots. Slot/proxy KeepAlive handles process
restart; controller journal reconciliation handles deployment state. Failed readiness,
uncertain drain, and incomplete bootstrap require explicit investigation, not a
broad restart or deletion of state.

## First installation and bootstrap

Perform the first :3000 ownership migration **after 18:00 or before 07:00 Central**.
It has a bounded initial maintenance gap; the zero-gap claim applies to subsequent
cutovers. Do all source/fixture review and rollback testing first. Require Claude's
independent branch approval, then live verification after each production step.

1. Run `verify:release-cutover`, `verify:continuity`, `verify:workspace-retention`,
   `verify:production-release-gate`, `verify:collector-release-lifecycle`,
   `verify:kernel-isolation`, `verify:closeout-application`, TypeScript, targeted lint,
   and the full build. Check the external spending gate without changing its files.
2. Integrate the reviewed branch into current forward `origin/production`. Deploy
   through the **existing installed legacy controller** using
   `OPSCENTER_RESTART_WHATSAPP_PHOTO_WORKER=false ./deploy/macmini/deploy-from-macbook.sh 127.0.0.1 origin/production`.
   Verify structured release identity, login, authenticated desktop and Claude's
   independent live check. This preparatory deployment still uses the old restart.
3. Install the reviewed controller explicitly with
   `./deploy/macmini/install-production-release-controller-from-macbook.sh 127.0.0.1 origin/production`.
   It stages and validates a complete versioned bundle, backs up the exact legacy
   controller, then changes one `controller-current` symlink. Public entry points
   resolve through that pointer. `controller-previous` and bundle `installation.json`
   preserve rollback hashes. Spending checker/allowlist and protected environments
   are neither copied nor modified. Installation itself starts no app or collector. Once slot mode or incomplete bootstrap is active, the installer refuses a
   controller replacement pending a separately reviewed proxy reload plan; proxy
   `/status` includes the loaded proxy/state-module SHA-256.
4. Under the installed deployment-control directory, run
   `node release-bootstrap.mjs prepare`. It acquires the same global lock, checks
   current production lineage and legacy listener ownership, backs up the legacy
   plist, installs three initially disabled new plists and warms slot A. Slot B
   stays unloaded. It preserves current plus up to two available rollback asset
   inventories. An incomplete bootstrap blocks routine deployment.
5. In the permitted time window, run `node release-bootstrap.mjs activate` from
   that installed directory. It repeats lineage/readiness and old PID checks,
   writes the private legacy launch block before sending graceful SIGTERM, waits
   for :3000 to be released,
   then starts the stable proxy. It verifies acknowledgement/public served SHA and
   enables slot mode. The old process may finish outstanding work while the proxy
   serves; never force it off. `launchctl disable` does **not** reliably stop
   KeepAlive relaunches on this host. The deployed `run_opscenter.sh` therefore
   checks `legacy-launch-guard.py` before secrets, PID locks or server startup.
   A blocked relaunch exits without serving; only after the original app PID
   exits is the guard-only legacy job unloaded. Bootstrap refuses a release
   without this guard. A failed activation invokes the rollback below.
6. Verify :3000, active slot, preview :3100, public ingress, relay readiness and
   authenticated desktop separately. Run `verify-coexistence.sh` and
   `verify-release-slots.mjs`. Have Claude independently check production.
7. Update the existing VPS gateway/observer from the same reviewed source using
   its existing owner and service workflow. Keep the 8-second probe, 2-second
   primary cache, 15-second standby cache and write/egress restrictions. Primary
   readiness now requires version 1, MC SHA, healthy `opscenter_production`, a
   migration identity and writable primary stores. Standby remains read-only.
8. Run at least **two real forward releases**, each through the normal wrapper,
   with independent public and VPS probes throughout and Claude verification
   before the next release. Capture exact cutover/observation times and count
   cloudflared `Unable to reach the origin` events in each window. Zero local
   failures alone does not establish zero ingress errors.

## Tested return to the original single-process setup

For the first bootstrap only, before any subsequent release, use the installed
`node release-bootstrap.mjs rollback`. It refuses a later active SHA. It blocks future
proxy launches and sends SIGTERM directly to its verified PID, preserving the slot for any
submitted work. Once :3000 is free and the original old process has drained, it
clears the legacy launch block only after the old job is safely unloaded, then
re-enables and starts the unchanged backed-up single-process plist at the same
release. It verifies full/public readiness before disabling slot mode. Slot/proxy
cleanup is deferred if work remains. It does not restart collectors, rewind Git,
replay requests, change credentials, or force-kill processes. If the legacy PID
still has work after 120 seconds, rollback stops with that fact and preserves the
slot/state. In this failed-first-bootstrap case :3000 may remain unowned. The
one-command remedy is to rerun the same installed `node release-bootstrap.mjs
rollback` after that original PID drains; it resumes the journaled handback.
Do not start a competing legacy process or force-kill the draining owner. Remain
present for the first migration; this failure mode is excluded from the routine
zero-downtime claim.

A rolled-back bootstrap can be prepared again: it first finishes any deferred
slot cleanup, archives the previous journal without deletion, and reuses only
byte-identical reviewed plists. Generation numbers continue increasing.

After a hard bootstrap crash, the installed bootstrap rollback command can reclaim
only its demonstrably dead journaled lock, preserving it as evidence. Inspect
`bootstrap.json` first; no hand deletion. A completed rollback is recorded explicitly
so normal legacy deployment works despite preserved diagnostic manifests. Do not
restore the old controller bundle while slot mode is active. Bundle rollback after
return to legacy is a reviewed atomic pointer restoration, not file-by-file copying.

## Receipts and retention

Keep source SHA, controller hashes, pre/post listeners, local/public/VPS identity,
Claude verdict, exact ingress log windows and independent probe totals in the
external dated handoff. `history.json` preserves the latest 100 activation receipts;
`deployment-history.tsv` keeps the existing format. Never store customer records,
credentials or raw operational logs in Git.

The installed retention helper protects both slot pins, active/rollback journal,
incomplete bootstrap, retained asset inventories and proxy drain/uncertainty references, in
addition to existing process and lock protections. Completed bootstrap history does not pin its first release forever; active slots
and current rollback inventories supply the live references. Invalid state fails cleanup
closed. Run only its ordinary policy; never delete a pinned release manually.
