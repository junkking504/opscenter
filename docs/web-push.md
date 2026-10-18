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
A→B→A transitions get new versions. Schedule removals/reappearances require
explicit complete authoritative evidence; missing clock/fleet rows are unknown. Moving off today's
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

There is no automatic age cutoff for retained, eligible deliveries. Restart catches
up the queue, subject to current role, category, revocation, expiry and activation
checks. Device expiry is bounded by the enrolling session and 30 days. Changing
categories cancels only pending excluded categories. Each supported event can alert
separately; a burst of N events can mean N notifications. Apple/Focus/network
policy still control presentation. Unknown outcomes are never blindly retried.

## Canonical capture, failure isolation and recovery

The Python wrapper calls each writer's original serialization/replacement callback
exactly once. With capture disabled it performs no journal I/O. Capture exceptions
never escape into canonical publication or the subsequent existing Slack publisher;
real canonical-write failures retain their original failure behavior. A publisher waits at most 100 ms for the shared lock; on contention it retains
a unique, fsynced hashed capture in a private pending spool after the original
write. No transition is intentionally replaced by a contention baseline. The
consumer watches that spool and invokes the byte-verified helper asynchronously;
recovery may wait up to 5 seconds for the lock, outside the canonical writer.
Startup and subsequent publications also drain pending captures, with a durable
commit checkpoint protecting a crash between ready-file and state writes. Synchronous filesystem stalls remain an OS/storage
limitation; this is not a guarantee against disk hangs.

Healthy capture prepares hashed facts in a private fsynced intent, invokes the
original writer, then commits immutable ready records and a sequence checkpoint.
Recovery finishes a confirmed write, aborts an unchanged old write, or records an
explicit coverage gap for an ambiguous write. Ambiguity cannot block the next
canonical publication. Missing journal storage uses a sanitized marker beside the
canonical file, imported on the next healthy capture. If both locations cannot be
written, stderr is the remaining diagnostic; immediate settings visibility cannot
be guaranteed during that storage failure.

Projection errors are isolated per market/scope. Full queues, missing source
proof and other capture failures leave durable scoped gap markers. Conflicting
overlaps retain hashed evidence and a non-resetting ordering warning. Gap overflow
records a capacity diagnostic; it never changes every source generation.
The consumer watches ready records and gap markers. Deterministic malformed or
unrecordable batches are quarantined; good scopes in the same file and later files
continue. Restart does not repeat quarantined poison records. Transient database
or filesystem failures stop the consumer with retained entries awaiting recovery.
No status claims complete notification delivery. Settings query all six expected
current-day scopes explicitly and show missing sources as unknown, plus known gaps.

After a capture gap, the next verified capture reconciles against retained known
observations in a new sequence generation. It does not silently baseline a genuine
transition. Its transaction records a recovery timestamp/generation; settings show
recovered coverage with missing-history wording, rather than permanently blocked.
Restarting cannot reopen that resolved marker. Gap IDs are cached per consumer;
unchanged files do not cause database writes on every wake. Conflicting ordering
warnings stay unresolved because a successful later write alone is not proof that
the conflicting evidence was superseded. Uncaptured intermediate events remain
unknown; retained pre-gap events remain eligible. No complete-delivery claim.

Capacity and retention (owner approved initial-schedule silence and 14-day history,
2026-10-18; implementation only):

- Initial schedule roster is silent. Subsequent proven changes are eligible.
- Ready plus quarantine share 10,000-entry / 128 MiB admission limits; pending plus
  prepared/quarantined pending files share those limits; each capture is at most
  8 MiB. Concurrent independent admissions can exceed an aggregate check by
  in-flight writers: these are admission guards, not an atomic disk quota.
- Ambiguous ordering evidence has separate 10,000-entry / 128 MiB admission bounds.
  Pending, quarantined and uncertain records are never deleted just to free space.
  They block retirement of referenced scopes. Unparseable retained evidence
  conservatively blocks all source retirement. Resolving these exceptions needs
  explicit operational review; capacity exhaustion remains a visible coverage gap.
- Acknowledged journal archive is bounded to 14 days, 10,000 entries and 128 MiB.
  Terminal notification events retain 14 days; pending/sending deliveries do not
  expire by age. Security audits and expired/revoked device records retain 90 days.
- Source/checkpoint scopes strictly older than the Chicago service day minus 14 days
  retire only when no pending/sending delivery exists, database and producer
  generation/sequence agree, and no retained file references the scope. The cutoff
  day itself stays. Orphan gap scopes use explicit database-absence proof.
- Both stores retain a compact monotonic date floor before deleting per-scope
  metadata. Replay below that floor cannot recreate a retired scope or notify.
  Filesystem completion followed by DB rollback is safe to reconcile on restart.
  Corrections older than 14 days are ignored by current capture. Existing retained
  backlog is drained before maintenance; unexplained old replay fails closed.
- Active metadata remains capped at 1,000 scopes, 128 MiB producer state and 10,000
  identities per scope. The latest 10,000 batch digests and per-scope watermark
  protect active replay. Normal old daily scopes now retire; retained exceptions
  can still exhaust capacity and require disposition before long-lived operation.
- Maintenance is event/startup driven without new polling. File retirement uses
  the producer lock and database source locks, and skips repeated empty helper
  work within one cutoff day. Terminal cleanup also runs every 100 batches.
- V2 source-date validation uses publication time (14 past/90 future Chicago service
  days), so ordinary valid retained publications survive consumer delay.
  Legacy entries without publication time can be quarantined with a visible gap.

Prepared writer coverage (no runtime files installed):

| Source | Exact publication | Evidence / ownership |
|---|---|---|
| Market stream | `history/junkware/schedule-watchers/ID/junkware_schedule_fast_DATE.json` through `write_snapshot` | Verified market/date, IDs, status/time/assignment; collection-start timestamp |
| Forward/full raw | `junkware_DATE_raw.json` | Verified market rows; full external collector patch preserves original raw writer |
| Fast full | `junkware_schedule_fast_DATE.json` | Same per-market scope as raw/stream |
| Requested day | `junkware_schedule_requested_DATE.json` via forward writer helper | Verified per-market snapshot, explicit collection-start timestamp |
| Krewe | `daily_metrics_DATE.json` via `source_aware_metrics.atomic_json` | Current employee source, explicit clock-in/out facts; ambiguous duplicate person is a gap |
| Fleet | `linxup_alerts_DATE.json`, staged external collector hook | Complete verified native geofence entered/exited rows with mapped truck, ID and event time |

These schedule writers share market/date scopes. Inspection and a pure extracted
normalizer fixture establish that stream and full collection use the same page
normalizer and retain page status/type/truck/time. The full refresh additionally
enriches crew fields; the stream's empty placeholders do not prove assignment
removal. Only verified detail evidence owns those fields, and absent detail fields
preserve prior hashes. Verified explicit empty assignments can still clear them.

Identical projected facts deduplicate without lowering observation watermarks or
resetting a generation. A changed observation is accepted in the existing temporal
sequence only when its read interval does not overlap the prior accepted read.
Conflicting overlapping or regressed observations retain their hashes in `uncertain`
and a scoped warning; they cannot overwrite accepted state or force its next real
change silent. No later-start/supersession assumption is made. This preserves known
ordered transitions but does not resolve all cross-writer uncertainty: a conflicting
verified fact may be retained without a push until a provable ordered observation
supports it. An authoritative upstream cursor or reviewed reconciliation contract
is still needed before claiming complete coverage. Same-path full/forward writers
are subject to the same interval check; a filename alone does not establish order.

Only verified complete schedule snapshots support missing-row removals. Missing
Krewe/fleet rows do not mean clock-out/departure; explicit facts supply those events.

Initial bootstrap is silent. After uninterrupted capture started on an earlier
Chicago service day, the first current-day Krewe/fleet facts notify. A first-seen
past service day is tagged `historical_first_seen` and seeds history; publication
now does not establish that its old clock/geofence facts are new live events. Each new schedule
scope starts with the owner-approved silent roster baseline; only subsequent
proven changes are eligible.

Raw positions, geometry-inferred visits, payroll amounts/finality, computed daily
summaries, manual correction overlays and provisional legacy metrics remain
outside this contract. No Slack history or Slack publication state is consumed.
Upstream collection cadence/request volume is unchanged. Journal/DB notifications
drive delivery immediately after supported facts are recorded, without batching.

`prepare-web-push-source-hooks.py` reads external source code and stages four files;
it never installs/runs them. Unknown or legacy hook anchors fail closed. Deployment
must coordinate all source-owned collectors plus external `collect_junkware_daily.py`,
`collect_linxup_alerts.py`, `source_aware_metrics.py` and the shared helper under
existing collector locks. The dispatcher requires an absolute
`OPSCENTER_WEB_PUSH_CAPTURE_HELPER` whose bytes match its release helper, preventing
recovery with a different journal format. Capture requires its separate flag and
absolute private journal directory; sending remains independently disabled.

Approved future pause procedure: stop capture writers under their existing locks,
mark the journal with helper `--pause`, set capture off and sending off, then stop
the dispatcher. `--pause` records per-known-scope gaps and a renewed bootstrap
time; it does not change flags or create an all-source reset marker.
If capture was disabled without a marker, mark a gap before resuming. If only
sending stops, capture may fill its bounded queue but canonical/Slack publication
continues with explicit gaps. Resume requires helper-version verification, recovery,
retained backlog review, scoped gap/recovery visibility and preserved-observation
reconciliation checks.
Never discard pending/uncertain records to clear an alarm. None of these operational
steps was executed as part of this local revision.

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
1. Review the prepared source contracts, initial baseline behavior, unresolved ordering and retention;
   approve the explicit coverage limits before activation.
2. Obtain independent review of the exact final commit and test evidence.
3. Separately approve branch integration/PR/push as needed, deployment and database
   migrations 0002–0007 through the installed deployment controller.
4. Approve coordinated collector-hook installation, private journal setup,
   supervisor installation, public/private configuration and sender activation with
   source baseline/recovery checks. No credentials were created by this revision.
5. Device owner installs the Home Screen app and grants opt-in permission.
6. Separately approve one actual iPhone delivery/revoke/expiry test.

Recovery after approved activation: follow the coordinated capture/sender pause
procedure above, revoke affected devices when authorized and preserve uncertain outcomes. An accepted notice can
still appear within the five-minute TTL. Never blindly replay uncertain attempts.

References: [WebKit](https://webkit.org/blog/13878/),
[Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers),
[RFC 8030](https://www.rfc-editor.org/rfc/rfc8030),
[RFC 8292](https://www.rfc-editor.org/rfc/rfc8292).
