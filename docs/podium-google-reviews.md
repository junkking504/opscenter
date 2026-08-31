# Podium Google Reviews integration

OpsCenter uses Podium as the authoritative read-only feed for Google reviews.
Podium returns reviews newest first and identifies the original review site, so
the collector filters to `Google` without relying on the limited Google Places
sample. Marketing → Reviews shows each active Podium location separately,
including rating, total count, newest reviews, low ratings, and reviews that
still need a response.

## Access and OAuth

Create a private Podium developer application with this exact redirect URI:

```text
https://ops.junk-king.app/api/integrations/podium/callback
```

Request only `read_reviews` and `read_locations`. No message, contact, payment,
review-write, or response-write scope is required. Podium developer access is
requested at `https://developer.podium.com/`; its application should describe
the use case as a current Podium customer reading its own Google review data for
an internal operations dashboard.

Store credentials in the Mission Control login Keychain under account
`opscenter`:

```text
com.opscenter.podium-client-id
com.opscenter.podium-client-secret
com.opscenter.podium-token-encryption-key
```

The encryption key must be 32 random bytes encoded as base64 or 64 hexadecimal
characters. Never write these values to Git, chat, logs, or a Business share.
The OAuth refresh token is encrypted with AES-256-GCM at
`~/Library/Application Support/OpsCenter/podium/tokens.json`.

After deploying the integration, authorize it from Marketing → Reviews or:

```text
https://ops.junk-king.app/api/integrations/podium/connect
```

Only an OpsCenter administrator can start or complete the OAuth route.

## Collection and verification

The collector writes verified snapshots outside Git:

```text
data/podium-google-reviews/current.json
data/history/podium-google-reviews/podium-google-reviews_YYYY-MM-DD.json
```

Run and verify the first collection before installing the schedule:

```sh
npm run collect:podium-reviews -- --data-dir /Users/missioncontrol/.openclaw/workspace/opsbot/data
npm run verify:podium-reviews
./deploy/macmini/install-podium-reviews-collector.sh
```

The dedicated LaunchAgent checks every 15 minutes. A failed request preserves
the last verified snapshot; it never substitutes a partial result. Production
deployment restarts the collector only after it has been explicitly installed.

## Appointment and crew attribution

OpsCenter first uses the exact phone or email from a Podium review invitation
to find a completed JunkWare job from the preceding 90 days. Reviews without
that exact identifier match remain unassigned. For those reviews, Marketing →
Reviews cross-references the public reviewer name against completed JunkWare
customer names and proposes only conservative matches: exact full name, exact
first and last name, or a first/last-initial match. Same-territory and more
recent completed jobs rank first when more than one candidate exists.

A name match is a suggestion, not employee credit. A manager or administrator
must confirm the displayed JK number or choose a different completed
appointment. Confirming or re-assigning the review records the appointment,
territory, truck, and recorded crew in the durable operator store:

```text
data/operator/podium_review_assignments.json
```

The assignment record excludes the customer name, phone, email, and Podium
invitation identifier. Confirmed assignments override collector attribution and
remain editable from the attributed review card after later Podium refreshes.
