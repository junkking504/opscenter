# Waypoint iPhone notifications and office messages

Crew iPhone notifications are separate from OpsCenter's manager notification trial
and ongoing grants. The owner approved new jobs, cancellations, schedule/route
changes and office messages on October 21, 2026. No manager role is granted to a
crew phone. Existing Apple Web Push and signing material are reused without a new
provider, paid SDK, inference call, source polling, or WhatsApp path.

In Waypoint, authenticated live phones with today's truck/crew selected open
**Notifications & office messages**. On iPhone, use Share → Add to Home Screen,
then open that icon and tap **Enable notifications** once. The browser's
permission request occurs only from that tap. Today’s connection and current truck
are rechecked before enrollment and before each network attempt, including after
DNS. The control displays the server’s current enabled state, not just a saved
browser preference. Revocation, expiration, a truck change and unsubscribe block old queued work.
Daily expiry pauses delivery without clearing the browser’s opt-in. After daily
truck/crew setup, Waypoint automatically restores the existing enabled subscription
using its private browser capability, without another permission prompt or tap.
Returning to Waypoint or refreshing messages retries a missed restore. Server-side
revocation, provider expiry and an expired subscription are never silently undone.
Notifications do not bypass inspection or grant appointment access.

The lock screen contains only a generic truck-update notice; no customer name,
address, office-message body or financial detail is sent. Tap opens the authenticated Updates view on
the same origin. The view shows non-sensitive change categories and links to the
current route and office messages; sign-in keeps this fixed destination. The service worker has no fetch handler, cache or data endpoint.
Waypoint has no in-app disable control. iPhone notification permission remains
controlled by iOS; server-side unsubscribe/revocation stays available to invalidate
a subscription and is respected by automatic restore.

Office dispatch uses **Crew dispatch → Message [truck]**. Messages are immutable,
limited to 1,000 characters and the selected truck/current Central date. An exact
manager session is required. Durable request IDs make uncertain submission checks
idempotent; the browser retains the same request and service date across reloads. Exact
replays from a previous day acknowledge only the original saved message; an
unsaved old-day draft cannot publish today. An explicit discard action clears
a draft without recalling any saved message. Saving records
an office message, not evidence of push arrival. Crew APIs read only their current
truck's messages. React renders message text without HTML. Notification permission
is optional; messages remain available through Refresh messages.

## Capture and delivery semantics

The dedicated sender watches existing local JunkWare schedule, route-order,
assignment, dispatch and phone-state directories. Database NOTIFY wakes it for
subscriptions and messages. There is no source/provider polling. On each wake it
compares the latest verified Waypoint truck projection, excluding financial
fields, against durable per-device schedule and office-message baselines. First
baseline and first view of another truck/date are silent. An unavailable schedule
never becomes a removal; message baselines still advance independently.

Filesystem events can coalesce, so this is a latest-update alert, not a complete
history of every intermediate schedule change. Status changes, including completion, can produce schedule updates. The source reader retains its
existing freshness and verified-membership rules and shared Amazon visibility.
A notification means open the latest authorized view. The sender never opens
JunkWare or changes an appointment, payment, assignment or route.

One database transaction publishes a baseline, a hashed/minimal comparison
projection and a durable pending delivery with count-only context. Cosmetic
whitespace/note ordering is silent. Routine detail/completion changes wait at
most 15 seconds; a local due-work timer drains them without polling a source or
provider. New/removed appointments, timing/route changes, status reversals and
new office messages are immediate. A due delivery reserves all recent pending
rows for the exact device/phone/truck/date in one transaction and sends one
wake-up. An urgent event flushes routine pending work immediately; legitimate
A→B→A changes are retained, not suppressed by a historical-hash blacklist.
Every grouped row keeps its context and shares the attempted result. Context is
read only after current phone/day authorization and is restricted to that phone,
truck and date; it contains counts/categories, not customer details. First legacy
baseline changes without a comparison projection remain eligible as a generic
schedule update. Existing initial/new-scope silent baselines remain unchanged.

One database transaction publishes a baseline and a durable pending delivery.
A singleton database advisory lock prevents competing senders. A committed
`sending` reservation occurs before transport; startup turns leftover sending
rows uncertain and never retries them. Every transport outcome is recorded;
Apple HTTP 201 is acceptance, not handset presentation. 404/410 disables that
subscription. Errors/timeouts/unknown results are never automatically replayed.
Queues older than five minutes, prior-day queues, changed-phone/truck bindings and
revoked/disabled devices are skipped before send. An already initiated request
may finish after revocation; no recall is promised.

## Runtime

Migration 0011 adds only Waypoint-scoped device, baseline, message and delivery
tables. Existing manager notification tables, trial budgets and source hooks are
unchanged. Private subscription material remains in production PostgreSQL.
Office messages and completed delivery outcomes older than 14 days are retired at
sender startup; pending/sending work is protected from deletion. Subscriptions belong to a random private browser capability retained on the
iPhone, independent of the enrolling manager. The server stores only its hash.
Daily setup automatically binds an already-enabled browser to the new phone session.
Restore requires current authorized phone/day access and the existing browser
capability and matching browser endpoint; it cannot create a subscription or enable
a disabled one. A revoked previous phone disables its subscription before restore,
even if the background worker has not yet observed the revocation. An unchanged
binding is a no-op, preserving its baseline and pending alerts. A new binding skips
old pending alerts and starts a silent baseline.
Other browsers cannot claim or unsubscribe its endpoint without that capability.
Enabled subscriptions are bounded to ten per current daily phone. Inactive daily
phone bindings retain the opt-in but cannot queue or send; they wait for restore.
Explicit phone revocation disables its subscription. Ordinary expired daily bindings
retain opt-in indefinitely so a returning phone does not lose its preference; these
rows remain subject to ownership, current authorization and provider-expiry checks. Re-enabling
resets the baseline and skips old pending notifications, keeping old alerts silent.
Disabled, settled subscriptions older than 14 days are retired at startup under
row locks; live subscriptions and unresolved delivery references are protected.

`~/Library/Application Support/OpsCenter/waypoint-push/config.json` is mode 0600
inside a 0700 directory, containing `{ "schema": 1, "enabled": true }`. An optional
Unix-millisecond `expiresAt` limits a supervised rollout; no expiry means the
explicitly enabled crew service stays on. A fresh private five-second `ready.json`
permits enrollment. The worker refreshes liveness every two seconds and closes
when disabled, expired, or a watcher/database fails. Source release or protected
environment changes restart the sender so roster/data-root settings stay aligned
with the web process. Startup revalidates the immutable release path. This is lifecycle checking,
not event polling. Launchd can restart the dedicated service after failure.

The reviewed external launcher runs `scripts/run-waypoint-push.py`, which loads an
allowlist of the existing protected production settings, pins the active immutable
release and sets role `waypoint-push-dispatcher`. The Node sender checks role and
configuration, acquires singleton leadership and only then retrieves the existing
VAPID key from Keychain. Web/preview code never reads the key. No browser profile,
credential or session is copied into source. Install/start the dedicated LaunchAgent
only after review and controller deployment. Stop by disabling config and checking
lease removal, or boot out that exact service. Never alter the separate manager
trial or running supervisor as part of Waypoint activation.

## Verification

`node --import tsx scripts/test-waypoint-push.ts` runs isolated PostgreSQL with
synthetic phones, snapshots and send callbacks. It covers ownership, silent
baselines, new/change/removal snapshots, source outage, office idempotency,
cross-truck isolation, truck switches, daily expiry and accepted/uncertain no-replay.
Run typecheck, targeted lint, spending checks, the existing crew/dispatch tests,
service-worker/browser fixtures and production build before exact-commit review.
Physical iPhone permission and real presentation/tap-through remain separate
acceptance evidence; never claim arrival from Apple acceptance alone.

The sender decodes shell-quoted roster JSON (including apostrophes) without evaluating shell commands. Malformed roster arrays stop startup rather than silently leaving eligible phones without notifications. After updating the reviewed launcher source, reconcile the installed `waypoint-push/run-waypoint-push.py` copy and restart only `com.opscenter.waypoint-push`; routine application deployment does not replace that external launcher. Verify a fresh ready lease and current-phone baselines.

## Session recovery and update entry

A failed phone/account read is unknown access, not evidence that a new enrollment
is needed. Entry waits for checks and offers retry on failure. An already-connected
enrollment response retains its 409 safeguard and carries a typed recovery code;
the client restores only a successful current-cookie GET read. Failed read-back
preserves pending recovery state. No code validation, manager grant, day or
inspection requirement is bypassed. Existing named-manager remembered-browser
restoration is bounded to Waypoint entry/gateway routes and preserves current
identity precedence, duplicate-cookie denial and demotion/revocation checks.

`verify:waypoint-recovery` runs credential-free manager, change-policy and service
worker tests. `verify:waypoint-recovery:browser` covers synthetic failed/interrupted
reads, repeated submits, 409 recovery and notification entry at phone/desktop
widths. `node --import tsx scripts/test-waypoint-update-grouping.ts --database`
uses an isolated temporary PostgreSQL cluster and mocked send callbacks to verify
group reservation, routine timing, urgent events, private scoped context and no
accepted/uncertain replay. These checks do not establish iPhone presentation.
