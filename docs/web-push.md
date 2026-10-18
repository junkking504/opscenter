# Direct OpsCenter Web Push — prepared, disabled

This feature is prepared locally. It has not been deployed, activated, independently
reviewed by Claude, or tested on a handset. Slack publishers, settings and history
polling are unchanged. Push does not consume Slack history.

## User experience

Managers can open the bell panel, choose Schedule changes, Krewe clock changes,
and/or Fleet arrivals and departures, then tap Enable Notifications. On iPhone,
use iOS 16.4 or later, add OpsCenter to the Home Screen, open that app and explicitly
grant permission. A normal browser tab is not the supported iPhone installation.
The initial provider scope is Apple Web Push (Safari/iPhone), not Chrome/Firefox.

Permission and subscribe calls occur only after the tap. Registration alone does
not request permission. Server storage is session-owner scoped; the server ignores
client owner fields. The current device can save categories, renew, or disable;
other devices belonging to the same account can be revoked. The opaque device ID
in localStorage is a convenience, never an authorization credential. Server revoke
is authoritative even if local browser cleanup fails. Subscription rotation requires
a new explicit authenticated tap. A different account cannot take over an endpoint.

The lock screen receives only “Operational updates are available. Open OpsCenter
to review.” No names, addresses, payroll, counts, category, event IDs or URLs are
sent. A notification opens the fixed same-origin Command page and the normal login
boundary applies. The service worker has no fetch handler, Cache API or authenticated
fetch. It is public code with no secrets; its updates are served with no-store.

Ownership follows the existing authenticated account. Shared login users share that
account's devices; this preparation does not introduce person-specific identities or
change access. Devices expire at the earliest of browser expiry, the enrolling login's
expiry and 30 days. Saving renews them. Signing out alone is not device revocation;
use Disable before handing over a device, or revoke it from another logged-in device.

## Canonical events and delivery

`lib/web-push-events.ts` reads existing local canonical projections: schedule rows
by appointment ID/date (status, truck, window, driver/navigation assignment), Krewe
clock-in/out fields by stable member/day identity, and native LinxUp entry/exit IDs.
It never invokes collectors, Slack, inference, or vendor reads. Missing/stale source
batches are skipped, never interpreted as no changes or healthy coverage. Only the
current Chicago operating date is scanned. Existing pollers and Slack remain untouched.

The worker records per-source baselines and hashed observations in the existing
PostgreSQL kernel, with sequence numbers for true state transitions, including
reversions. Identical snapshots do not notify. The first usable snapshot of each
category/day seeds a baseline without sending old history. A missing source gets
its own baseline when it first becomes available. Changes before subscription or
activation are not replayed. Changes occurring wholly between snapshots can be
missed; inferred/bounded geofence exits are not pushed in this pilot. These limits
must be accepted before activation. Payroll and photo/payment messages are out of
this initial category scope.

The worker uses a session advisory lock, event/device unique keys and commits a
reservation before sending. Per-device locks serialize revoke/preferences with
sending. One generic wakeup coalesces pending changes for a device in each run;
at most 50 devices are attempted per invocation. Events older than 15 minutes are
skipped; push TTL is 5 minutes. HTTP 201 means **provider accepted**, not handset
receipt. 404/410 remove subscriptions. Other statuses are rejected; timeouts,
process crashes and unknown outcomes become uncertain and are never blindly retried.
This deliberately favors duplicate avoidance over guaranteed delivery. The notification
tag also replaces prior generic notices. Apple/Focus/offline policy can delay or
suppress presentation. Source and queue metadata retain 7 days; audit rows 90 days.

## Security and operational boundary

- Signed sessions plus existing manager/admin permission; strict configured Origin,
  cross-site rejection, bounded 8 KiB request bodies, category/key validation,
  maximum 10 devices per account and owner-filtered revoke/list/update queries.
- Exact `https://web.push.apple.com` host and constrained provider token path only.
  No arbitrary destination, configurable allowlist, credentials in URLs, ports,
  query strings, redirects or proxy support. DNS is bounded to 3 seconds; only
  validated public IPv4 addresses are pinned into the TLS request. TLS still verifies
  Apple's host. IPv6-only resolution fails closed. Requests time out in 8 seconds.
- Empty-body RFC 8030 pushes use RFC 8292 VAPID with Node's native P-256 signing.
  No encryption library or extra runtime package is introduced because there is no
  application payload. A cryptographic and Apple interoperability review is still
  required before live use. VAPID keys were subsequently created under the separate
  signing-setup approval; the private key remains in Keychain.
- `MISSION_CONTROL`, `OPSCENTER_WEB_PUSH_ENABLED=1`, a valid activation timestamp,
  VAPID public/private keys and a mailto subject are required. Every default invocation
  exits before reading sources/database/network. Preview runtimes cannot send.
- Subscription endpoints/keys remain private database data. They are not returned
  by list APIs, printed in errors, included in Git or placed in audit events.
  The database backup/access model must be checked during security review.
- Registered local action names: `push.device.subscribe` and
  `push.device.unsubscribe`; durable audit rows record the session owner/action/device.
  No user-facing endpoint can invoke dispatch.

## Existing runtime and cost assessment

The existing Mission Control Node runtime and local PostgreSQL kernel can host the
store and worker. After separate approval, run `scripts/run-web-push.ts` once per
minute using the existing local scheduling infrastructure. This is a proposed
configuration, not an installed or running job. No new cloud server, paid provider,
subscription, Apple Developer Program membership or inference is required. Apple
states Web Push uses APNs without Developer Program membership. This design adds
small local CPU/database/network work; actual server uptime, DNS egress, database
migration privileges, deployment packaging and delivery latency remain unverified.
It makes no guarantee of zero existing power/network costs or future provider policy.
No recurring billable service is being introduced or enabled by this branch.

The initial build stopped at the existing spending gate for `web.push.apple.com`.
On October 18 the user separately approved only that host and protected VAPID
signing setup, with no added cost. Source and installed host inventories now include
that exact host; both gates pass. The checker, other hosts, dependencies, protected
pins and paid limits are unchanged. The protected installed pair was backed up and
checksummed. The initial blocked result remains in the private evidence history.

The private key is stored only in the user Keychain under account `opscenter`,
service `com.opscenter.web-push-vapid-private-key`. The feature's existing secrets
loader now includes it, pending code review/deployment. Mode-0600 `production.env`
contains the public key, subject reusing the already-configured support contact,
`https://ops.junk-king.app` origin, `OPSCENTER_WEB_PUSH_ENABLED=0`, and a blank
activation timestamp. The original environment is backed up only in the protected
configuration-backups directory. No services were restarted or scheduled. Do not
load this signing key into preview. Future approved worker setup must use the
production environment and reviewed secrets loader without logging their values.

## Approval sequence — signing setup complete, activation still off

1. Obtain independent Claude review of the exact commit, especially authentication,
   shared-account ownership, endpoint/DNS/TLS controls, VAPID protocol, migration,
   queue locking, retention and lost-device behavior. Record the review receipt.
2. **Completed:** narrow Apple-host approval and installed inventory update. Both
   spending gates pass with all other controls preserved. Full build and regression
   results are recorded separately; they do not waive independent review.
3. Approve production integration and deployment separately. Check current production
   lineage; use the installed immutable-release controller. Apply migration
   `0002_web_push.sql` to the intended existing kernel with backup/recovery validation.
   Confirm public service-worker delivery and authenticated API/source behavior.
4. **Completed:** separately approved VAPID generation/storage and public origin/subject
   configuration. Private key is in Keychain; sending remains disabled. The loader
   change must still be independently reviewed and deployed with the feature. It
   retrieves the private key only for explicitly enabled Mission Control runtimes;
   disabled and preview runtimes do not load the key.
5. Approve activation: set the activation timestamp and enable flag on Mission Control,
   and install the proposed once-per-minute worker scheduling. Verify source freshness,
   baseline seeding, durable queue health and rate limits. Do not enable a preview sender.
6. Obtain device-owner approval to install the Home Screen app, grant permission and
   subscribe the iPhone; separately approve a real test notification. Verify lock-screen
   presentation, tap-to-login, Focus/offline behavior, expiry/revoke and provider receipts.
   Mock tests are not handset-delivery evidence.

Recovery: disable the enable flag and stop only the approved push worker schedule;
revoke affected devices. Preserve uncertain receipts and do not replay them blindly.
A queued provider-accepted notice may still arrive within TTL after revocation.
Do not roll back production or alter credentials without the corresponding approval.

## Validation commands

`npm run verify:web-push` exercises policy, actual HTTP handlers with mocked sessions,
owner-scoped persistence with query doubles, source baselines/transition deduplication,
provider outcomes and service-worker events. `npm run verify:web-push:browser` uses a
local synthetic Vite fixture and mocks every permission/subscription/API operation.
The worker has not been tested against real PostgreSQL or Apple. Run both TypeScript
projects, lint, geofence/crew-progress/desktop-presentation/Slack-diagnostics checks
and desktop compilation. See the private task handoff for exact outcomes.

## Reference material

- [WebKit: iPhone Web Push and explicit user interaction](https://webkit.org/blog/13878/)
- [Apple: Sending Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [RFC 8030 HTTP Push](https://www.rfc-editor.org/rfc/rfc8030)
- [RFC 8292 VAPID](https://www.rfc-editor.org/rfc/rfc8292)
