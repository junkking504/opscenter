# Optional Pushover delivery for one manager

Prepared only. No deployed integration, enabled provider, credential installation,
live test, or handset acceptance is implied. No SDK or new polling is added.

The existing manager dispatcher can substitute Pushover for Apple delivery for
one separately approved subscription fingerprint. Existing role, category, device,
ongoing/trial expiry, canonical event ordering and durable no-retry claims remain
authoritative. Waypoint is unchanged. The Home Screen subscription must remain
enabled in OpsCenter: revoking it still stops this route. Unconfigured installations
use Apple exactly as before. Other approved subscriptions still use Apple.

Pushover receives existing alert titles and bodies (including customer/job details
and any crew/pay details present), plus an authenticated OpsCenter link. This is a
new data processor; unlike Apple Web Push these payloads are not end-to-end
encrypted by this integration. Explicit content/recipient approval is required.
Pushover limits the body to 1024 characters; clipping is marked with an ellipsis.
Sound is omitted to honor the phone's Pushover default. Priority is normal; no
quiet-hours bypass or repeating emergency messages. Tapping the notification
opens Pushover; its link opens OpsCenter. Provider acceptance is not proof of
handset delivery. Existing DB accepted/rejected/uncertain vocabulary is reused.

## Activation boundary

Before enabling: obtain explicit approval for `api.pushover.net`, existing alert
content, recipient account/device, replacement rather than duplicate Apple delivery,
up to 10,000 attempts over at most 30 days, and $0 additional API spend. Verify the
account's free sending quota. No upgrades, license purchase, subscriptions or
overages are performed. Each attempt makes at most one recipient-validation call
and one message call. Validation/failure/uncertain outcomes consume allowance.
No retries or automatic renewals exist. Events recorded before approval are rejected.

Prepare a reviewed host inventory addition and install it only under the separately
approved spending-control procedure. The installed gate deliberately rejects the
new host until then; do not modify or bypass its checker. Complete independent
review, integrate the approved exact commit and use the installed release controller.

Only after approval create a private mode-0600 JSON file outside Git, logs and
evidence. Set `OPSCENTER_PUSHOVER_CONFIG` to that absolute path in the dispatcher
environment. It contains schema=1, enabled=true, provider=pushover,
purpose=opscenter-notifications, approvedAt, expiresAt (at most 30 days later),
approvalReference, maxAdditionalSpendMicros=0, maxAttempts (1–10000),
content=existing-alert-details, subscriptionFingerprint (existing verified native
subscription), token, user and device (exact Pushover device name). Do not put
credentials in browser responses, Git, shell arguments or evidence packets.

Initialize `<config>.ledger.json` mode 0600 with schema=1, the same approvalReference,
and attempts=0 once. Missing/corrupt state blocks calls; never recreate/reset a used
ledger as a repair. Atomic replacement and a directory lock serialize reservation;
a crash leaving the lock requires operator inspection. Approval expiry, disable,
changed file or supervisor loss blocks subsequent sends. No Apple fallback occurs
after a Pushover error; removing configuration to resume Apple requires an explicit
operator change, not an automatic retry. No old events are replayed after repair.

Validate the user has only the intended active Pushover device. Each attempt checks
the provider's device list and rejects groups, additional devices or renames.
Pushover may fall back to other devices when the requested device is missing;
there remains a provider-side race if account devices change between validation
and sending. This is account delivery, not a cryptographic phone guarantee.

Mock verification: `node --import tsx scripts/test-pushover.ts` and the existing
Web Push regressions. A separately approved synthetic live test and user confirmation
of sound, phone receipt and link behavior are required before claiming success.

Sources: https://pushover.net/api and https://pushover.net/pricing.
