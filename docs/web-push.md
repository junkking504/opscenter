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
scope records a disappearance; it is not, by itself, proof of cancellation or a reschedule. Reporting a destination requires its own source evidence.
An incomplete initial baseline is blocked. No Slack-derived history is consumed.

`startPushDispatcher` uses a dedicated PostgreSQL connection for LISTEN and the
single-instance advisory lock. It drains on commit notifications and at startup;
a wake during a drain schedules another drain. It has no delivery polling timer.
Connection loss disables further claims and closes the dedicated connection.
An approved future supervisor can restart it, reestablish LISTEN and catch up from
the durable queue. Leftover sending attempts become uncertain and are not resent.

Claims take a short transaction, lock trial then device then delivery, recheck account role,
category, revocation, expiry, activation and event age, and require UPDATE RETURNING
to succeed. Network requests hold no database lock. Sends are sequential; every
event/device has its own outcome. No batching or frequency window is imposed.
A committed reservation consumes one of the three lifetime trial slots, including
crashes before network I/O, errors and uncertain outcomes. Revocation, approval,
role, category and deadlines are rechecked immediately before transport and after
DNS resolution. A network request already initiated may finish after revocation;
there is no recall guarantee. No retry is performed, including HTTP 429/5xx.
HTTP 201 means accepted by Apple, not delivered to the handset. 404/410 revoke the
subscription and clear its approval. Timeouts and unknown outcomes stay uncertain.

## Notification presentation and verified reschedules

OpsCenter's three manager notification categories (schedule, crew clock events,
and fleet geofence events) use concise titles and plain-text, newline-separated
labeled details. Schedule details lead with appointment date and Central time,
then the verified JK job identifier (canonical appointment identity remains
unchanged), customer, normalized truck, status/type, available address/phone,
positive recorded job amount and verified crew. Estimate placeholders and empty
end times are omitted. Fleet includes event, location, date and Central time;
crew includes name, clock event and source time, with verified final clock-out pay as described below. Display-only metadata does
not create business transitions or alter audience/role checks. Slack formatting
syntax is not sent. The separate Waypoint crew app's generic wake-up path is not
part of these OpsCenter manager categories and is unchanged.

The private observation `notification_json.schedule` context records verified
date/time/status and labels, but encryption sends only title/body/eventId and an optional strictly allowlisted job path. The
worker correlates the same canonical appointment identity across schedule scopes.
Migration 0012 adds a partial identity lookup index. A unique counterpart requires
both its observation transition and latest source snapshot within 15 minutes of
the incoming event. Later partial or unchanged reads cannot refresh old evidence.
Uniqueness is checked across both present and absent peers, including conflicting
statuses. Ambiguous, stale,
future-dated, legacy-without-context, canceled or removed counterparts do not prove
a reschedule. Same-scope verified time changes are also recognized. A new known
time replacing an unknown time alone is not proof of a move. Equivalent clock
formats and newly supplied end times are not treated as moves.

When the old scope disappears first, the notice says **Schedule changed** and
explicitly leaves cancellation/new date/time unverified. When a later verified
destination arrives, **Rescheduled** leads with `To: date, time (Central)` and
`From: date, time (Central)`, followed by destination details. If destination
arrives first, a reschedule is confirmed only after verified old-scope absence.
Explicit source canceled/removed statuses retain their meanings. Missing destination
time never becomes invented timing. This adds no collection, polling, delay,
replay or rewriting of previously delivered messages. Existing metadata is
populated by normal canonical publication; legacy entries remain conservative.

The body preserves newlines through encryption and `showNotification`. Application
limits are 100 title code points and 1,600 body code points plus a clipping ellipsis,
with title/body and optional job-path JSON bounded to 2,800 UTF-8 bytes (including escapes). This leaves
space for the event ID beneath the existing 3,000-byte plaintext limit and
4,096-byte encryption record. Tests independently decrypt and exercise the service
worker in a VM, without sending or creating an OS notification.

[iOS supports notification expansion](https://support.apple.com/en-euro/guide/iphone/iph6534c01bc/ios),
but [Web Notifications](https://notifications.spec.whatwg.org/#dictdef-notificationoptions)
exposes one body, not separate collapsed/expanded layouts or an option to force
long-press height. iOS/WebKit owns wrapping, truncation and app attribution.
Passing multiline text proves payload support, not how many lines a particular
handset shows. The inspected producer/renderer supplies no `from OpsCenter`
subtitle; that separate attribution cannot be suppressed through these payload
options. Opening defaults to authenticated Command, or the existing authenticated job page for a verified date/JK reference. Physical-device acceptance remains separate and unperformed.

## Device-specific trial gate

Migration 0008 creates an inert singleton with no owner, approved device, start,
deadline or consumed attempts. Deployment never starts the clock. There is no
HTTP approval, start, reset or account-wide bypass. This revision supports one
bounded trial, not unrestricted ongoing notifications.

A separately authorized local operator prepares the exact authenticated owner
identity. The user's explicit permission tap submits a pending candidate. First
enrollment is never approval, including concurrent phones using the same login.
The operator must verify the intended phone's displayed device ID and full
SHA-256 fingerprint (fixed ordered endpoint, p256dh and auth fields) before
explicitly approving that candidate. Other candidates cannot fan out or send.
After approval, a competing device or key rotation cannot replace it through the
web API. Shared-login users can still revoke devices; that can deny service but
cannot grant another device approval. Losing the intended browser subscription
requires revocation, a new candidate and separate verification/approval.

Approval permits a device expiry of 1–30 minutes, additionally bounded by the
login/subscription expiry. Saving categories cannot extend approval. Trial start
is a separate explicit local operation: its immutable deadline is exactly 30
minutes later. Starting does not extend a shorter device expiry. Explicit device
replacement preserves both clock and attempt budget; expired, exhausted or
stopped trials cannot restart. There is deliberately no reset command.

Fan-out and claims require the approved device and subscription fingerprint.
Only canonical facts recorded after trial start are eligible; pretrial retained
history is still recorded but never sent by this trial. Claims reserve a unique
ordinal 1–3 in the same transaction as the sending status, before network I/O.
The reservation ledger survives event/device retention. Concurrent drains cannot
overspend; process restart never refunds a reservation or retries an uncertain
attempt. Deadline checks use the database clock after lock waits. Transport checks
again after DNS; request timeout and provider TTL are bounded by remaining trial
and device lifetime (maximum 8 seconds and 5 minutes respectively). Apple may
already have accepted or displayed a notice when revocation/expiry occurs.

Local controls are in `scripts/control-web-push-trial.ts`, using explicitly loaded
Mission Control production configuration without a signing secret. `status
--owner <verified-identity>` is read-only. Mutations require `--apply` and
`--approval-reference <approved-action-record>`, plus:

- `prepare --owner <verified-identity>` only after audience preparation approval.
- `approve --owner <verified-identity> --device <verified-id> --fingerprint
  <verified-full-fingerprint> --expires-minutes <1-to-30>` only after that device's
  identity is confirmed and separately approved.
- `start` only after explicit live-trial approval and coordinated source/consumer
  readiness. This is the only action that starts the clock.
- `revoke --owner <verified-identity> --device <verified-id>` revokes the exact
  approved/candidate device even after expiry; it preserves the trial clock and budget.
- `stop` records a permanent stop and skips pending work. The UI's Disable device
  revokes that subscription; expiry and rejection also block later sends.

Do not run these mutations during a disabled deployment. A future approved trial
must coordinate capture and dispatcher supervision and a pause at the end;
expiration stops sending but does not itself uninstall hooks or stop capture.
The API/UI expose pending approval, fingerprint, deadline and consumed attempts.
No client refresh or enable tap approves a device or starts/restarts the trial.

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
- Equivalent unresolved observations deduplicate by scope, field group and fact
  hashes, excluding collection timestamps and writer paths. Repeats do not create
  new files or gap IDs; distinct conflicts remain visible. Admission is bounded
  to 10,000 files / 128 MiB.
- Ready/pending captures and pending/sending deliveries are protected at any age.
  Uncertainty, quarantine and pending-quarantine can expire only when every known
  service-day scope is before the cutoff, each has a locked DB acknowledgement
  with no pending/sending delivery, and no ready/pending capture references it.
  Mixed current/old records remain intact. Business-source data is never deleted.
- Expiry first saves a durable intent with file hashes and the resulting aggregate
  counts. Replay after interruption cannot double count. `retention-audit.json`
  keeps counts by class, byte count, cutoff and producer ordinal; `state.json`
  keeps the replay floor and retired-scope count. No source facts are in the audit.
- Unscopable/malformed withheld files remain retained and counted: their approved
  service-day age cannot be proved. They do not pin unrelated old scopes because
  a repaired record still cannot bypass the replay floor. They consume bounded
  capacity and eventually require a separate disposition policy. Filesystem mtime
  is not business-source truth. Unknown ready/pending captures still block retirement
  until consumed into quarantine or scoped by recovery.
- Acknowledged journal archive is bounded to 14 days, 10,000 entries and 128 MiB.
  Terminal notification events retain 14 days; pending/sending deliveries do not
  expire by age. Security audits and expired/revoked device records retain 90 days.
- Source/checkpoint scopes strictly older than the Chicago service day minus 14 days
  retire under DB source locks with no pending/sending delivery or ready/pending
  reference. Explicit obsolete-evidence disposition also allows a poisoned/ahead
  producer checkpoint to retire under both replay floors; without that disposition,
  generation/sequence must match. The cutoff
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
- A cheap maintenance gate opens only for cutoff rollover or eligibility changes:
  consumed old backlog, changed pending spool, old-delivery completion/skip, and
  device/category changes. Normal current-day wakes do not repeat DB/helper scans.
  Restart invalidates the gate after deliberate evidence repair. One private
  acknowledgement file carries the full set without OS argument limits. No timer
  is introduced. Terminal cleanup also runs every 100 batches.
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

These schedule writers share market/date scopes. Actual writer inspection and a
pure extracted-normalizer fixture establish two evidence groups. Page status,
type, truck, time, end and membership are shared by stream/full collection.
The full writer derives assigned_truck from page truck; it is not independent crew
truth. Driver, navigator and additional crew require verified enrichment with no
detail error. Missing enriched fields and stream placeholders preserve known hashes;
present verified empty values can clear known fields.

Each group has its own collection interval. A stream read cannot advance the crew
checkpoint, and a conflicting page read does not suppress an independently ordered
crew change. First-seen crew fields seed silently; later changes to known fields
notify. The full writer's scraped_at precedes enrichment, so publication time is
the conservative end bound for crew reads. Later start alone is not supersession
proof: conflicting overlapping reads within a group remain explicit uncertainty.
An older detail row cannot revive a removed appointment.

Equivalent conflicts are retained once. Distinct conflicts remain unknown and may
expire only under the counted scope policy above. Settings distinguish withheld
facts, blocked capture and unknown sources. No upstream revision cursor or complete
coverage guarantee is claimed.

Only verified complete schedule snapshots support missing-row removals. Missing
Krewe/fleet rows do not mean clock-out/departure; explicit facts supply those events.

Initial bootstrap is silent. After uninterrupted capture started on an earlier
Chicago service day, the first current-day Krewe/fleet facts notify. A first-seen
past service day is tagged `historical_first_seen` and seeds history; publication
now does not establish that its old clock/geofence facts are new live events. Each new schedule
scope starts with the owner-approved silent roster baseline; only subsequent
proven changes are eligible.

LinxUp raw archives under `alerts/raw/` are excluded from capture, even though
they share the normalized feed filename. Only the validated normalized alert
publication establishes Fleet coverage; malformed normalized feeds still record
a coverage gap.

Raw positions, geometry-inferred visits, payroll amounts/finality, computed daily
summaries, manual correction overlays and provisional legacy metrics remain
outside this contract. No Slack history or Slack publication state is consumed.
Upstream collection cadence/request volume is unchanged. Journal/DB notifications
drive delivery immediately after supported facts are recorded, without batching.

Schedule market scoping accepts the collectors' exact `Junk King …` labels and
the existing short labels, keyed to the verified market ID. A geographic territory
never overrides an explicit market; an unknown label remains incomplete coverage.
The writer-contract test extracts both collectors' actual market constants and
projects their normalized synthetic rows, so invented fixture labels cannot mask
an incompatible producer contract.

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
Never discard pending captures/deliveries to clear an alarm. Withheld evidence
expires only through the counted scope policy above, without bypassing its guards. None of these operational
steps was executed as part of this local revision.

## Privacy, enrollment and transport

Managers/admins choose schedule, krewe and fleet categories and explicitly tap
Enable Notifications. On iPhone use an iOS 16.4+ Home Screen web app. Permission is
never requested on mount. Devices belong to authenticated accounts; shared-login
users consequently share device ownership. Signing out is not revocation.

The owner explicitly requested detailed lock-screen alerts on October 21. Selected
source descriptions are encrypted end-to-end to the verified subscription using
RFC 8291 / RFC 8188 aes128gcm; no plaintext message is sent to Apple. The default same-origin link opens `/desktop?workspace=Command`; a verified date/JK reference may open the allowlisted existing job route through normal authentication.
The service worker has no fetch/cache handler, is served no-store and uses a
event-specific tag with renotify. Actual updated Safari presentation is unverified.

Enrollment checks use only public VAPID configuration. The private key loader
requires enabled Mission Control plus `OPSCENTER_PROCESS_ROLE=push-dispatcher`;
web/preview roles clear an inherited push private-key variable. No Keychain or
protected environment change is part of this revision. The existing separately
approved key and host setup remain unchanged and sending remains disabled.

The exact Apple host and token-path rule, public IPv4 DNS pinning, TLS hostname
validation, redirect denial, DNS/request timeouts, owner checks, strict Origin,
8 KiB input limit and ten-device cap remain in place. The real Q-prefixed endpoint
shape remains unverified and fails closed. No arbitrary endpoint forwarding.

## Manager visibility of journal headroom

The existing manager-only, private/no-store `GET /api/push/devices` response now
includes `journal` health. The settings panel shows it while enrollment is disabled
when a journal path is configured. The path is server configuration only; neither
request input nor the response contains filesystem paths, fact contents or secrets.
A database outage does not hide independently available queue measurements.

Three admission groups match the producer's 10,000 files / 128 MiB guards:
ready plus quarantine; pending JSON plus prepared markers plus pending quarantine;
and uncertain evidence. The reader sums file metadata, reports used and remaining
files/bytes, clamps remaining capacity to zero on overflow, and labels the sample
time. It excludes acknowledged archive and temporary files, just as admission
does. This is admission headroom, not disk free space or a hard atomic quota.
Concurrent admissions can exceed the guards. CPU, storage, connections and lock
headroom still require a monitored runtime trial; synthetic tests do not measure them.

`unscopableRetained` is explicitly the count **at the last retention scan**, with
that audit file's modification timestamp, not a fresh count. The current count
may differ; even an old scan's zero must not be read as current health. Missing,
malformed, oversized, future-dated or unreadable audits display unknown. A missing
journal does not become a healthy empty queue. Symlinks and non-regular entries
are rejected; changing directories or excessive directory scans give unknown
headroom rather than misleading partial totals. No evidence payloads are read.

Sampling happens on existing settings loads/saves and an explicit **Refresh
status** button, with no background polling, new timer, retention run or producer
invocation. Each group visits at most 20,002 directory entries; audit reads are
bounded to 64 KiB. No cleanup or disposal is performed by the status reader.
Unscopable disposal remains a separate, operator-reviewed decision if it accumulates.

## Runtime and cost

Uses installed Node and existing PostgreSQL. No new service, provider SDK,
subscription or metered inference is introduced. Runtime CPU/storage capacity,
dedicated session connection availability and deployment wiring still need review.
This is a no-new-provider design, not evidence of unlimited free capacity.

The reviewed preparation includes `scripts/supervise-web-push.py` and a disabled
launchd template. The supervisor runs the journal consumer/dispatcher as a
long-lived child, with RunAtLoad and KeepAlive both false. Installation and start
remain explicit runtime operations; importing or deploying the source does neither.
Deployment must supply the existing authenticated role resolution to the sender
without exposing private signing material to web processes.

## Bounded supervisor and enrollment-only setup

The supervisor pins the active immutable release and requires the installed
canonical helper to match it byte for byte. It reads only an allowlist of existing
production configuration into a minimal child environment. Observe mode requires
`OPSCENTER_WEB_PUSH_ENABLED=0`, uses role `push-observer`, denies every owner for
fanout/claims, and never retrieves a signing key. Enrollment can separately use
`OPSCENTER_WEB_PUSH_ENROLLMENT_ENABLED=1`; the prepared-owner trial gate still
applies. The default web API additionally requires the live supervisor lease.
Unsubscribe remains available after enrollment is disabled.

The private state directory is
`~/Library/Application Support/OpsCenter/web-push` (0700), with `journal/` (0700)
and `sender.json` (0600). The latter has `mode: off|observe|send` and an absolute
Unix-seconds `setupUntil` at most one hour from launch. This setup bound does not
start or extend the database trial. A stable private flock prevents two supervisors.
No second instance may remove the running instance's lease. Launchd must use the
prepared template without auto-start or automatic restart.

Before starting the child, the supervisor conservatively pauses/reconciles the
journal and marks the prior coverage gap. It waits up to 45 seconds for the
child's nonce/PID readiness after recovery, dedicated DB leadership, listener and
journal initialization. Only then it renews a private five-second capability file.
Canonical hooks whose capture environment flag is absent check that lease at
the existing publication call. They never change canonical collection cadence or
Slack publication. Explicit capture=0 still disables capture. No delivery timer
or source polling was added: journal filesystem events and committed PostgreSQL
NOTIFY remain the delivery triggers. The local lease timer is lifecycle safety.

The API rejects enrollment when the lease disappears/expires. Default owner
eligibility and the real transport require a `send` lease matching that child
nonce, checked again after DNS. A child orphaned by a supervisor crash therefore
loses sending permission within five seconds. The supervisor also holds the only
write end of a liveness pipe whose read end the child inherits
(`OPSCENTER_WEB_PUSH_PARENT_FD`). Any supervisor exit, including SIGKILL, delivers
EOF; the child then stops its journal and dispatcher, releasing leadership and
signing material, and exits. This is event-driven, not a timer. A SIGKILL still
skips the supervisor's own cleanup, so `sender.json` may remain non-`off`; check
it before a manual restart. Already accepted notices can remain within the
bounded provider TTL. Observe mode grants no sending permission.

A signal, child exit/readiness loss, operator configuration change or setup expiry
removes the lease first, terminates only that child's process group, calls the
canonical helper's locked pause/recovery to retain pending records and mark gaps,
and persists `mode: off`, even when recovery fails. Recovery failure requires
inspection; it must not be interpreted as a healthy shutdown. The child also
stops at the database trial deadline, explicit stop or the third reserved attempt.
An observer stops if a trial is started. No run resets attempts, deadline or audit.

Approved installation order: stage exact source hooks and record input/output
hashes; deploy the reviewed release with no lease or services running; back up
external writer files; acquire the existing refresh and LinxUp writer locks; check
input hashes again; atomically install the exact helper before the hook importers;
verify output hashes and release/helper equality. Do not steal a busy lock or
replace changed source. Then provision private state and the disabled LaunchAgent,
supply the same owner/role resolution, explicitly prepare the intended owner and
start observe-only setup. Verify known baselines and unresolved source health
before opening enrollment or considering any send. Never approve the first
candidate automatically. Match the phone-displayed device ID and full subscription
fingerprint to the intended owner and require their actual readiness before start.

For coordinated manual stop, set `sender.json` mode to `off` atomically or stop
this supervisor; verify lease absent, child stopped and retained gap evidence.
Then set enrollment/capture/sending configuration off, stop the trial if started,
and verify the authenticated API reports enrollment disabled. Do not delete
pending or uncertain evidence or reset the trial. A later mode change never
restarts the process automatically.

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
   migrations 0002–0008 through the installed deployment controller.
4. Approve coordinated collector-hook installation, private journal setup,
   supervisor installation, public/private configuration and sender activation with
   source baseline/recovery checks. No credentials were created by this revision.
5. Device owner installs the Home Screen app and grants opt-in permission.
6. Separately approve one actual iPhone delivery/revoke/expiry test.

Proposed acceptance sequence (all live steps still require approval):

1. Review the exact final revision, then separately authorize any PR/push/merge.
   Verify the current production ancestry before integration.
2. Approve disabled staging through the installed controller, including migrations
   0002–0008. If source hooks are included, separately approve their installation
   and install the reviewed helper first. Keep capture, enrollment and sending off.
   Verify deployed revision, service health and authenticated manager status as
   separate checks. Missing journal measurements must remain unknown.
3. Separately authorize private journal/supervisor provisioning and restricted
   public/private configuration (including VAPID credential creation/configuration).
   Do not widen Apple endpoint validation or change access to make acceptance pass.
   Verify health-path access and sample timestamps under the intended web identity.
4. Approve a coordinated, supervised capture/dispatcher start and owner-only trial;
   never leave capture running without its consumer. Verify silent baseline and
   category filters. Explicitly approve enabling enrollment/sending and constrain
   the enrolled audience to the one owner device before any event can notify.
5. With separate enrollment permission, Eugene installs/opens the Home Screen app,
   signs in, selects categories, taps Enable Notifications and grants OS permission.
   Verify the displayed device ID and fingerprint, then separately approve that exact candidate with a short expiry. Explicitly start the trial only after readiness and live-trial approval. A browser mock is not evidence of the actual Apple endpoint or handset behavior.
6. With explicit real-notification/test approval, perform one controlled canonical
   event delivery, inspect minimal lock-screen content and safe deep link, then
   test revoke and expiry with no blind replay of uncertain attempts. Approve any
   additional enrollment/delivery needed for those acceptance cases explicitly.
7. Monitor throughout the 30-minute trial: lock_busy, pending spool, uncertain/quarantine admission
   headroom, last-scan unscopable count/age, CPU, disk and DB connections. Stop on
   unexplained gaps, unknown measurements or unsafe resource pressure. Preapprove
   the coordinated journal pause plus sending-disable rollback; retain evidence.

Recovery after approved activation: follow the coordinated capture/sender pause
procedure above, revoke affected devices when authorized and preserve uncertain outcomes. An accepted notice can
still appear within the bounded provider TTL. Never blindly replay uncertain attempts.

References: [WebKit](https://webkit.org/blog/13878/),
[Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers),
[RFC 8030](https://www.rfc-editor.org/rfc/rfc8030),
[RFC 8292](https://www.rfc-editor.org/rfc/rfc8292).

## Verified-phone ongoing delivery

After actual handset presentation and authenticated deep-link acceptance, a local
operator may explicitly `promote` the same approved device/fingerprint. Migration
0009 is inert: deployments never promote. The command requires the verified owner,
full device ID/fingerprint, `--handset-confirmed`, the original verified enrollment
expiry, `--apply`, and the human approval reference. Promotion requires an accepted
trial reservation and preserves the original trial clock, three-slot ledger and
attempt count. There is no reset or automatic promotion.

Ongoing delivery records separate durable reservations, has no three-attempt cap,
and individually sends subsequent supported schedule, crew and Fleet transitions.
It preserves canonical-source deduplication and the same owner/device/category,
role, lease, expiry, endpoint and pre-network/DNS checks. Retained history recorded before promotion and ongoing reconcile/gap-recovery
transitions are withheld from delivery; the fresh reconciled snapshot restores
the baseline for subsequent changes. This avoids a historical burst on resume; uncertain attempts are never retried. Disable device and operator stop
remain effective. Replacement and expired grants require a new reviewed procedure;
browser saves cannot extend approval or replace the verified phone.

Authorization is bounded by the original authenticated enrollment/subscription
expiry and at most 30 days from enrollment. New subscriptions persist their
enrollment expiry separately; legacy promotion must supply the previously verified
ceiling, additionally capped by creation + 30 days and Apple subscription expiry.
The panel displays the authorization expiry. Ongoing attempt receipts retain 90
days, preserving pending/sending claims. No new provider, polling or collection
frequency is introduced.

An explicitly installed sender configuration may set `ongoing: true`, `mode: send`
and `setupUntil` equal to the grant expiry (at most 30 days). Other sessions retain
the one-hour setup bound. The supervisor refreshes its lease every two seconds (rather than 0.5 seconds)
to reduce ongoing disk writes. The lease still expires within five seconds, child
leadership and helper matching remain required, and every supervisor stop pauses
capture. The operator may set RunAtLoad for this authorized configuration;
KeepAlive stays false, so anomalies require investigation rather than automatic
restart. A graceful stop, including shutdown, persists mode off and requires an operator
restart. RunAtLoad can resume a still-valid saved send configuration after an
abrupt power loss; it does not undo a graceful stop. The panel shows paused
when the supervisor lease is absent.

## Detailed alerts — owner requested October 21

Schedule changes include appointment ID/customer label and the supported changed
fields (status, time, truck and verified crew), with known before/after values.
Crew alerts include the source employee name, clock-in/out and source time. Fleet
alerts include the truck, entered/left geofence and local event time. This earlier preparation was superseded by the explicitly requested completion/pay and appointment-detail presentation below; whole source records and raw GPS tracks remain excluded.

Selected bounded display metadata now lives in the private journal/state and
notification/observation tables under existing retention (events retain 14 days; observation/journal scope
metadata retires after its operating day plus 14 days, including future-dated
schedule scopes);
this supersedes the earlier hash-only/generic-lock-screen preparation policy.
Message formatting never drives event identity or weakens ambiguity handling.
Metadata-only upgrades record descriptions without manufacturing an event.
Schedule text includes only field values accepted by interval reconciliation.

Each push uses a fresh ephemeral P-256 key and salt with the handset's subscription
keys. Payloads are bounded, authenticated and encrypted. Built-in Node crypto
implements RFC 8291 and RFC 8188, with independent receiver-side HMAC derivation,
wrong-handset and tampering tests. No new dependency, provider, endpoint or paid
usage is added. Messages have event-specific tags, so distinct changes retain
distinct notifications. Clicks default to authenticated Command; verified schedule records may use the strictly allowlisted authenticated job path described below.

The service worker immediately activates an updated installed version and claims
clients, with no fetch/cache handler. The phone must revisit/reload OpsCenter to
check the new worker; real detailed handset presentation remains an acceptance
check distinct from encryption tests and Apple HTTP acceptance.

Protocol sources: https://www.rfc-editor.org/rfc/rfc8291.html and
https://www.rfc-editor.org/rfc/rfc8188.html.

The owner explicitly selected individual alerts for each supported change; bulk
appointment edits can consequently produce multiple alerts. No coalescing or
per-window batching is imposed. Local encryption validation failures are recorded
as rejected/message_invalid, with the reservation retained and no retry.

## Requested completion and clock-out hierarchy — October 21–22 preparation

This local revision prepares display changes only. No production release, source
mutation, provider call, test notification or recipient/access change was made.
The all-alert catalog is a separate private task artifact; Slack-only and internal
families are designs, not new manager-push subscriptions or emitters.

Genuine transitions from known non-completed status use `Truck #N` with body
`Job Completed`, verified JK/customer, source load, price and payment method on
separate lines. Billed tender ends with exactly `Billed`; it never claims paid or
collected. Already-completed revisions use `Completed Job Updated` (or Estimate).
Internal appointment IDs are never converted into JK references by prefixing.
Price uses schedule revenue, excluding gratuity but retaining recorded job
charges (including card surcharges). Closeout total includes gratuity, so its
recorded tip is removed before comparing with revenue or using it as a fallback.
Use the closeout tip first, then the schedule tip; blank tip fields mean no
recorded tip. Invalid tips or a tip greater than the total cannot provide a
closeout price fallback. Tender amounts, balance and load price alone never
substitute for job price. Unexplained net-price conflicts and stale/failed
closeout details remain unknown; valid schedule revenue is still usable when
closeout details are unavailable. Payment method remains a separate line.
Load quantity is full units plus the selected partial, as established by
`closeout-load-price.ts`; bags and dry runs retain their distinct semantics, and
unlabeled numeric option values never become guessed fractions.

Estimate bodies use `Estimate Completed`, JK/customer, verified driver/navigator,
Load (recorded load/bedload price and size), Labor, applicable recorded other charges/discount, Total, Arrival, Departure and
Photos. Total is the source estimate, not paid revenue. Labor accepts the existing
name/label/description aliases; unidentified or invalid labor evidence is unknown,
not zero. GPS display uses a bounded read of the existing fresh local appointment
visit snapshot at projection time, frozen before pending-spool retention. No new
collection or polling is introduced. It requires date/internal ID/truck/JK match,
confirmed non-pass-by timing, and excludes operational-only, conflicting,
superseded, bounded or overlapping intervals. A stale open copy cannot erase a
confirmed closure. Missing duration is never calculated into a GPS assertion.
Photo count uses only existing allowed JunkWare media references; no media URL is
persisted in the push payload or publicly shared.

Clock events use title `Krewe`. Clock-out body is name/time, Total pay, Hourly pay,
Tips and Bonuses, in that order. Pay must be final/current in the same published
record with as-of evidence after clock-out. Unknown/provisional amounts remain
`Not verified`, explicit zero remains currency zero, and inconsistent totals are
not recalculated. Salary daily extras are not called total salary; applicable
supplemental pay is a separate line. No payroll record is written or recomputed.

Readiness does not change event identity: late closeout or payroll enrichment
alone does not replay or replace an already delivered notice. The first event may
therefore show unknown fields if its detailed source is not ready. Clock-out is
not delayed or suppressed. A guaranteed later enriched notification needs a
separately reviewed delivery/update policy, not a misleading completeness claim.

Native facility alerts use compact action/location/time followed by service date
and Central timezone. The exact legacy LinxUp location label `Warehouse` renders as
`NOHQ`, matching the existing geofence display alias. Names such as `Baton Rouge
Warehouse`, `Warehouse Annex` and other facilities remain unchanged. Source
geofence names, coordinates, event identity and timestamps are not changed. Existing confirmed customer on-site/departure notifications
are a separate Slack family (`buildTruckVisitSlackNotifications`); they are not
currently input to manager Web Push. Their requested layouts are in the catalog,
without a new event bridge, cadence, bootstrap or routing change in this repair.

Verified JK schedule records can open only `/jobs?date=YYYY-MM-DD#job-jkNUMBER`.
Date and JK syntax are allowlisted during serialization and again in the service
worker at click time. Internal IDs, unknown dates, arbitrary URLs/query strings
and invalid paths fall back to authenticated Command. The optional path is inside
the 2,800-byte serialized message budget. Authentication/roles remain unchanged;
the service worker still has no fetch/cache handler. Sender event identities and
all delivery gates are unchanged.

There is one plain notification body, no custom expanded layout or forced line
count. Safari/iOS does not support the notification image field in current
[MDN compatibility data](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Notification.json).
Use the verified photo count and authenticated job page instead of promising inline
attachments. iOS may truncate earlier than our payload limit. Unit/VM/encryption
tests are not physical-handset or long-press verification. The separate app
attribution line is not supplied by this payload and has no API suppression option.

Regression coverage includes semantic completion precedence, additive load units,
billed/mixed tender, unknown/conflicting source detail, estimate fields and GPS
exclusions, final/current versus unknown pay, privacy-safe photo counts, authenticated
job-link allowlisting, encrypted round trips, VM clicks and zero-recipient database
presentation cases. Existing journal baseline/recovery and dispatch tests remain
in the required no-cost suites. No browser test was run under the headless/no-window
restriction.


### Owner-specific truck-move notices

Optional `OPSCENTER_WEB_PUSH_TRUCK_MOVE_OWNER` is one exact authenticated owner ID,
not a global category switch. Unset means unchanged delivery. Only that owner's
manager-push delivery is omitted when canonical changed fields are exactly truck,
with unchanged date, time, status, type and customer label. This applies regardless
of actor and includes existing appointments assigned from the virtual/unassigned
truck and truck-only corrections to completed appointments. Genuine completion,
cancellation, new/removal, crew changes and date/time reschedules remain visible.
Events and observations are retained; other owners and Waypoint are unaffected.
Unknown/legacy change metadata leaves delivery on. No actor inference, receipt
lookup, collection, delay, replay, payment/source write or access change is added.
The setting is a delivery preference, not an enrollment or role grant, and its
production activation requires separate release approval.

## Contextual alert details and item navigation

Native notification clicks with a retained event ID open `/desktop` alert details
first. The authenticated, manager-only GET `/api/push/notification` returns a
retained receipt only when a delivery was attempted to a device owned by that
account. It never enrolls, sends, marks read, acknowledges, or changes a record;
responses are private/no-store. Missing or expired receipts show a concise
unavailable state. No notification content is placed in the URL.

The details headline opens the corresponding record. Geofence headlines select
the exact truck on the operations map, preserve the event day, and display GPS
freshness; historical dates never display current-position pins. Schedule links
retain exact appointment IDs when available and otherwise retain the JK reference
without guessing among matches. Crew links retain member identity when known.
Fleet load/record alerts retain the truck record. Unmapped alerts keep their
source details without inventing a destination. Destination panels open and reveal
once after loading, clear of the header; refreshes do not repeat the scroll.

Legacy notifications without a retained event ID keep their previously allowlisted
job route or Dashboard fallback. Existing delivery categories, approvals, expiry,
Waypoint preferences, and sending limits are unchanged. Browser fixtures and
service-worker doubles do not establish physical handset delivery/tap acceptance.

Alerts without a valid source retain their visible details without inventing a headline destination. Existing valid source links, including Finance and Marketing, remain headline destinations when no more precise record identity is available. Pushover keeps its existing generic desktop fallback and existing job links; the native receipt flow does not change its link contract.

## Manager notification destinations

OpsCenter notifications serve managers monitoring operations; crew-only filtering
in Waypoint does not change manager event coverage. Verified appointment notices
retain their exact job/date link. Notifications without a job link open the
matching Schedule, Krewe or Fleet workspace. Clicking reuses an existing OpsCenter
window when it can navigate; otherwise it opens the requested destination. Pushover preserves its existing job-link and generic fallback contract.
No new transport, approval, polling or external sending is enabled by this change.
