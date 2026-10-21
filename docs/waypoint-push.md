# Waypoint iPhone notifications and office messages

Crew iPhone notifications are separate from OpsCenter's manager notification trial
and ongoing grants. The owner approved new jobs, cancellations, schedule/route
changes and office messages on October 21, 2026. No manager role is granted to a
crew phone. Existing Apple Web Push and signing material are reused without a new
provider, paid SDK, inference call, source polling, or WhatsApp path.

In Waypoint, authenticated live phones with today's truck/crew selected open
**Notifications & office messages**. On iPhone, use Share → Add to Home Screen,
then open that icon and tap **Enable notifications for today**. The browser's
permission request occurs only from that tap. Today’s connection and current truck
are rechecked before enrollment and before each network attempt, including after
DNS. The control displays the server’s current enabled state, not just a saved
browser preference. Revocation, expiration, a truck change and unsubscribe block old queued work.
Enable again after daily enrollment; browser notification permission persists.
Notifications do not bypass inspection or grant appointment access.

The lock screen contains only a generic truck-update notice; no customer name,
address, office-message body or financial detail is sent. Tap opens Waypoint on
the same origin. The service worker has no fetch handler, cache or data endpoint.
Disable revokes the server subscription first, then unsubscribes the browser.

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
Daily re-enrollment explicitly binds the same browser to the new phone session.
Other browsers cannot claim or unsubscribe its endpoint without that capability.
Enabled subscriptions are bounded to ten per current daily phone. Re-enabling
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
