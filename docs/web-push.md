# Direct OpsCenter Web Push — local preparation, sending off

The delivery core is prepared and tested locally. Canonical producer integration
is **blocked**, so the command-line entry point fails closed even if deployment
flags are accidentally supplied. No deployment, activation or handset test has
occurred. Slack publishers, configuration and history polling are unchanged.

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
Old events with terminal receipts expire after seven days, audits after 90 days.
Source sequence/digest and observation hashes are retained to avoid ID reuse;
a bounded archival/checkpoint policy is still required before live activation.

## Canonical integration blocker

The inspected collector code replaces the daily schedule snapshot using a temp
file and rename (`collect_junkware_daily.py`), and daily metrics through
`source_aware_metrics.atomic_json`. The schedule reader checks date and market
coverage, but that is not a durable sequence of every persisted snapshot. Krewe
reads daily metrics plus attendance/correction inputs; a single file watcher is
not an authoritative completeness contract. Existing schedule-change publication
state is coupled to Slack and must not be reused as the push event source.

A watcher can observe A then C after an intermediate persisted B is overwritten.
It therefore cannot promise notifications for every recorded event. This branch
removes the earlier snapshot-scanning runner and intentionally does not add a
lossy watcher. Source producers must first supply a retained ordered journal or
an atomic persistence/outbox hook. That source integration and its completeness
contracts require a further scoped change; no collector or webhook was modified.
Fleet history is retained in its own source format, but its persistence hook has
not been connected to this core. All three categories remain unconnected.

The upstream detection cadence is separate from recorded-event dispatch latency.
No live cadence measurements were taken, and no fixed ten-minute snapshot filter
remains in the recorder. Actual source freshness contracts remain unresolved.
This core cannot manufacture events that upstream never recorded or retained.

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

A future supervisor would run a long-lived dispatcher with KeepAlive, not a timed
job. No runnable launchd file is supplied while producer integration is blocked.
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
1. Resolve canonical producer integration/completeness and metadata retention.
2. Obtain independent review of the exact final commit and test evidence.
3. Separately approve branch integration/PR/push as needed, deployment and database
   migrations 0002 and 0003 through the installed deployment controller.
4. Approve sender installation and activation with source baseline/recovery checks.
5. Device owner installs the Home Screen app and grants opt-in permission.
6. Separately approve one actual iPhone delivery/revoke/expiry test.

Recovery after approved activation: disable sending, stop the dedicated dispatcher,
revoke affected devices and preserve uncertain outcomes. An accepted notice can
still appear within the five-minute TTL. Never blindly replay uncertain attempts.

References: [WebKit](https://webkit.org/blog/13878/),
[Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers),
[RFC 8030](https://www.rfc-editor.org/rfc/rfc8030),
[RFC 8292](https://www.rfc-editor.org/rfc/rfc8292).
