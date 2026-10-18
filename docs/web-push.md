# Direct OpsCenter Web Push — local preparation, sending off

The delivery core and canonical publication hooks are prepared and tested locally.
Capture and sending remain disabled by default. No collector installation,
production migration, deployment, activation or handset test occurred in this
revision. Slack publishers, configuration and history polling are unchanged.

## Event recording and dispatch

`recordPushBatch` accepts retained, ordered canonical snapshots. Each scope has a
contiguous durable sequence and batch digest: gaps, reordering or conflicting
replays produce a sanitized health reason instead of silently losing transitions.
The producer must retain each snapshot until its transaction commits. A snapshot
watcher over a replaced file does not meet this contract.

One transaction records hashed observations, versioned events, per-device delivery
intents and `pg_notify`. PostgreSQL delivers the wake only after commit. The first
complete snapshot seeds a baseline. Identical snapshots do not notify; genuine
A→B→A transitions, removals and reappearances get new versions. Missing rows produce
tombstones only with explicit complete authoritative evidence. Moving off today's
scope is a removal; reporting the destination requires its own source evidence.
An incomplete initial baseline is blocked. No Slack-derived history is consumed.

`startPushDispatcher` uses a dedicated PostgreSQL connection for LISTEN and the
single-instance advisory lock. It drains on commit notifications and at startup;
a wake during a drain schedules another drain. It has no delivery polling timer.
Connection loss disables further claims and closes the dedicated connection.
An approved future supervisor can restart it, reestablish LISTEN and catch up from
the durable queue. Leftover sending attempts become uncertain and are not resent.

Claims take a short transaction, lock device then delivery, recheck account role,
category, revocation, expiry, activation and event age, and require UPDATE RETURNING
to succeed. Network requests hold no database lock. Sends are sequential; every
event/device has its own outcome. No batching or frequency window is imposed.
A revoke committed after a claim cannot cancel that already-claimed attempt, but
prevents future claims. Revocation is soft so receipts survive. No automatic
retry is performed, including HTTP 429/5xx; a future retry policy must reauthorize
each attempt. HTTP 201 means accepted by Apple, not delivered to the handset.
404/410 revoke the subscription. Timeouts and unknown outcomes remain uncertain.

The maximum event age at claim is configurable through dispatcher dependencies
(default 15 minutes); stale events get an explicit skipped reason. This is an
outage guard, not a batching delay. Device expiry is bounded by the enrolling
session and 30 days. Changing categories cancels only pending excluded categories.
Each supported event can alert separately, so a burst of N events can mean N
notifications. Apple, Focus, browser and network policy still control presentation.

Source failures are isolated and persisted as sanitized codes in push_health.
Manager settings expose unknown or incomplete coverage without raw errors. Missing
storage returns a disabled state without an error banner. Existing devices can be
listed and revoked while sending is disabled. Operators do not render settings.
Terminal events expire after seven days; audits and expired/revoked subscriptions
after 90 days. Pending deliveries older than 15 minutes become explicitly stale.
Each active scope retains the latest 10,000 batch digests plus an archived-sequence
checkpoint. A replay below that checkpoint fails closed. Closed date scopes older
than seven UTC days expire; ingestion rejects reopening them. Maintenance runs at
startup and every 100 recorded batches, without a timer. All deletes in tests
operate only on a disposable database. Production application requires approval.

## Canonical publication hooks

`scripts/opscenter_push_journal.py` adds a durable publication boundary:

1. A shared OS file lock serializes all participating writers.
2. A private, fsynced intent stores selected observation hashes, the next sequence,
   and old/new snapshot hashes; it contains no source payload.
3. The canonical snapshot is atomically replaced and its directory is fsynced.
4. Immutable ready records and a durable sequence checkpoint commit the journal.

After interruption, recovery compares the exact snapshot hash. A committed
snapshot completes its journal record; an unchanged old snapshot aborts the
unpublished intent. An unexpected third state blocks further publication until
reviewed. Subsequent writers recover before any overwrite. Startup also recovers.
The consumer watches the immutable ready directory, drains all records in order,
and catches up at startup. Filesystem wake coalescing cannot lose intermediate
states. DB sequence/digest replay protects a crash between DB commit and archive.
Only committed entries move into the acknowledgement archive.

The ready queue is capped at 10,000 entries/128 MiB; capacity exhaustion stops the
opted-in publication visibly instead of dropping unacknowledged events. Archives
are bounded by seven days, 10,000 entries and 128 MiB. Sequence metadata is capped
at 1,000 scopes, with a seven-day past/90-day future source-date window. Source
observation lists are capped at 10,000. Capture requires the separately approved
`OPSCENTER_WEB_PUSH_CAPTURE=1` and an absolute private
`OPSCENTER_WEB_PUSH_JOURNAL_DIR`. Disabled capture does not access the journal.

Prepared coverage:

| Source | Publication hook | Contract |
|---|---|---|
| Schedule stream | `collect-junkware-schedule-stream.py::write_snapshot` | Verified date/market, appointment IDs, status/time/assignment facts; cancellation rows win overlapping live rows |
| Forward/requested day | `collect-junkware-forward-schedule.py::write_json_atomic`, reused by requested-day | Verified per-market canonical JSON; same scope/dedup as stream |
| Full/fast JunkWare collector | Staged patch to external `collect_junkware_daily.py` | Same normalized schedule projection at both canonical writes |
| Krewe | `source_aware_metrics.py::atomic_json` | Canonical dated metrics, current employee-source evidence, clock-in/out facts only |
| Fleet | Staged patch to external `collect_linxup_alerts.py` | Verified complete native geofence entered/exited records with mapped truck, identity and timestamp |

The first complete observation of each scope seeds a baseline without alerts.
Later changes, reversions, complete removals and reappearances create separate
intents. Incomplete source evidence never fabricates removals or healthy coverage.
The settings health response includes unknown entries for missing current-day
markets/categories. A recorded status proves ingestion, not ongoing upstream
freshness or complete coverage of every Operational update type.

Raw GPS positions, geometry-inferred visits, payroll amounts/finality, computed
summaries, manual correction overlays, and provisional legacy metrics are outside
this source contract. They are not represented as covered notifications. Their
future expansion needs explicit canonical event contracts and tests. No Slack
history or Slack publication state is used.

`prepare-web-push-source-hooks.py` reads the external collector source and emits
four staged source files into a new directory; it never installs or runs them.
Known syntax anchors are checked and unknown drift is rejected. The external
writers are under `/Users/missioncontrol/.openclaw/workspace/opsbot/scripts/`:
`collect_junkware_daily.py`, `collect_linxup_alerts.py`, and the
`source_aware_metrics.py` helper used by `process_daily_metrics.py`.
Installing the staged versions plus `opscenter_push_journal.py`, updating the local
source-owned collectors, and setting the shared journal path require a separately
approved coordinated deployment while holding the existing collector locks.
No further source-access blocker remains for these prepared writers.

Upstream collection still determines when a provider event is first recorded.
No upstream polling cadence or request volume is changed. Once a supported state
is committed, the journal wake and PostgreSQL NOTIFY drive dispatch immediately,
without a notification interval. Events never observed upstream cannot be created
by this system. A process/OS failure may delay delivery until supervised restart;
stale or uncertain outcomes are retained/skipped rather than blindly replayed.

## Privacy, enrollment and transport

Managers/admins choose schedule, krewe and fleet categories and explicitly tap
Enable Notifications. On iPhone use an iOS 16.4+ Home Screen web app. Permission is
never requested on mount. Devices belong to authenticated accounts; shared-login
users consequently share device ownership. Signing out is not revocation.

The lock screen says only that operational updates are available. The empty push
body contains no customer information, event IDs, counts or locations. The fixed
same-origin link opens `/desktop?workspace=Command` through normal authentication.
The service worker has no fetch/cache handler, is served no-store and uses a
shared tag with renotify. Actual Safari behavior is unverified.

Enrollment checks use only public VAPID configuration. The private key loader
requires enabled Mission Control plus `OPSCENTER_PROCESS_ROLE=push-dispatcher`;
web/preview roles clear an inherited push private-key variable. No Keychain or
protected environment change is part of this revision. The existing separately
approved key and host setup remain unchanged and sending remains disabled.

The exact Apple host and token-path rule, public IPv4 DNS pinning, TLS hostname
validation, redirect denial, DNS/request timeouts, owner checks, strict Origin,
8 KiB input limit and ten-device cap remain in place. The real Q-prefixed endpoint
shape remains unverified and fails closed. No arbitrary endpoint forwarding.

## Runtime and cost

Uses installed Node and existing PostgreSQL. No new service, provider SDK,
subscription or metered inference is introduced. Runtime CPU/storage capacity,
dedicated session connection availability and deployment wiring still need review.
This is a no-new-provider design, not evidence of unlimited free capacity.

A future supervisor would run `scripts/run-web-push.ts` as a long-lived dispatcher
with KeepAlive, not a timed job. No launchd configuration is installed or changed.
Deployment must supply the existing authenticated role resolution to the sender
without exposing private signing material to web processes.

## Verification and remaining approvals

`npm run verify:web-push` uses local mocks. `npm run verify:web-push:database`
creates a private disposable PostgreSQL cluster with a Unix socket, TCP disabled,
synthetic records and injected sender. It never uses runtime database URLs or
Keychain. The cluster is stopped and deleted after testing.
`npm run verify:web-push:browser` tests a synthetic local fixture with all
permission, subscription and API calls mocked. These are not handset tests.

Before any live use:
1. Review the prepared source contracts, initial baseline behavior and retention;
   approve the explicit coverage limits before activation.
2. Obtain independent review of the exact final commit and test evidence.
3. Separately approve branch integration/PR/push as needed, deployment and database
   migrations 0002, 0003 and 0004 through the installed deployment controller.
4. Approve coordinated collector-hook installation, private journal setup,
   supervisor installation, public/private configuration and sender activation with
   source baseline/recovery checks. No credentials were created by this revision.
5. Device owner installs the Home Screen app and grants opt-in permission.
6. Separately approve one actual iPhone delivery/revoke/expiry test.

Recovery after approved activation: disable sending, stop the dedicated dispatcher,
revoke affected devices and preserve uncertain outcomes. An accepted notice can
still appear within the five-minute TTL. Never blindly replay uncertain attempts.

References: [WebKit](https://webkit.org/blog/13878/),
[Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers),
[RFC 8030](https://www.rfc-editor.org/rfc/rfc8030),
[RFC 8292](https://www.rfc-editor.org/rfc/rfc8292).
