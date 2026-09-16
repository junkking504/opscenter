# WhatsApp job photo and Krewe expense intake

OpsCenter receives truck photos through Meta's official WhatsApp Cloud API and uploads them to the corresponding JunkWare appointment.

## Reviewing held photos in OpsCenter

Managers and administrators can open **Command → Control → Review WhatsApp photos**,
or use **Source Health → Review photo decisions**. The panel reads the current
`review`, `failed`, `processing`, and `incoming` queues across all dates, with
oldest-first pagination and filters for reason, masked sender group, and text.
Received and outcome times use America/Chicago. Queue observation time is
separate from the age of each message. Open panels refresh every 30 seconds and
on focus; inspection pauses refresh until the detail is closed. Failed reads
retain the last retrieved snapshot; missing directories and unreadable records
produce an explicit incomplete-view warning.

`GET /api/desktop/photos` is authenticated and manager-only. Its optional
`preview=<hashed record ID>&state=<queue>` serves only existing JPEG/PNG media
for a currently unresolved record, with identity, size, file-type and signature
checks and private/no-store caching. It does not retrieve media from Meta.
Raw sender phones, provider IDs and worker exception payloads are omitted.
There are no mutation handlers: opening the panel does not alter mappings,
retry an upload, release a hold, or delete a record.

Schedule links use the shared dated record-link builder and Schedule's `q`
filter; ambiguous JK references remain a choice. A link is a **job reference
on the message's received date**, not an
appointment match. Verify the intended appointment and existing JunkWare media
before any separately authorized recovery, especially for an uncertain upload.
An absent cached preview does not establish whether a photo was uploaded.

Regression check: `node --import tsx scripts/test-desktop-photo-review.ts`.

The same signed webhook accepts structured dump and fuel reports from the Krewe. These appear in Finance → Truck breakdown under **OpsBot Truck Records Detail**, corresponding to JunkWare Accounting → Truck Records categories. JunkWare exposes only daily Dumps and Gas dollar totals; OpsCenter retains the additional location, quantity, and time detail with the original WhatsApp message ID for audit and duplicate protection.

## Krewe dump and fuel reports

Krewe members can send `Dump` or `Fuel` by itself and OpsBot replies with an unlabeled example. Each value can then be sent as its own message, or the whole unlabeled list can be sent at once. OpsBot accumulates the values for that sender's active expense session, which remains open for up to 12 hours of inactivity or until a new `Dump`/`Fuel` command replaces it.

```text
Truck 1
Gentilly Landfill
$86.40
2 tons
```

`Weight:` is optional, including for locations such as Gentilly Landfill that do not provide net weight.

```text
Truck 1
Shell
24 gallons
$100
```

All fuel fields except time are required. Strong shapes identify the values without labels: `Truck 1`, a plain-text location, `$100`, and `24 gallons`. Order, spacing, punctuation, line breaks, and capitalization are flexible; common variants such as `T1`, `Truck#1`, `24g`, `24 gal`, `gallons 24`, and `100 dollars` are accepted. OpsBot always uses the timestamp of the WhatsApp message that completes the expense as the transaction time; a time in the message is neither required nor used. Labeled forms remain supported for compatibility. OpsBot validates every field and sends a terse confirmation after writing the durable Truck Records detail. Sender phone numbers are stored only as one-way hashes in expense records and never shown in Finance.

The desktop WhatsApp linked-device connection is useful for staff visibility, but it does not expose a supported inbound webhook. Production intake therefore requires the Operations number to be registered with a Meta WhatsApp Business Account and subscribed to the OpsCenter webhook.

## Matching policy

1. An explicit `JK` number in the image caption wins over prior text. Otherwise use context from the same sender and receiving WhatsApp inbox during the preceding 10 minutes. Multiple JK numbers or multiple appointment IDs for one JK require review.
2. Without a JK number, the sender phone is mapped to a truck and OpsCenter uses that truck's GPS position at message time.
3. The nearest non-cancelled appointment is selected only when GPS is fresh, the truck is within 0.5 mile, and the next-nearest appointment is at least 0.15 mile farther away.
4. Missing mappings, stale GPS, excessive distance, ambiguity, unknown JK numbers, and uncertain upload outcomes go to the review queue. They are never auto-attached to a customer job.

The worker saves a JPEG/PNG original in private runtime storage before job matching, so held photos retain a preview and recovery copy. Both inbound and provider checksums, image signature, receiving inbox, and the 5 MB limit are checked. Retries reuse a valid cached original; corrupt or unverified caches require another provider download. Existing holds without a cache still require source media recovery; this change cannot recreate missing originals.

New images freeze their matching context when queued, including an empty context when no preceding text can be verified. Later messages cannot change that photo's destination. Text history is kept in private runtime `context-history/<sender hash>/<inbox hash>/` files, identified by timestamp and message hash; delayed images can use the context that preceded their own timestamp. Existing records retain a legacy-context fallback. Future text, another inbox, and conflicting same-second context are never used. A category-only caption retains the preceding JK; a new truck, expense, or unrelated message ends that context. Text delivered after the image was queued does not retrospectively release it.

The caption keywords `before`, `after`, `donation`, or `receipt` select the JunkWare image category. An explicit caption category overrides older context; an explicit caption JK prevents a prior truck-status request from diverting the image into load analysis. Photos without a category keyword default to `After`.

## Meta configuration

Create or select the Junk King Meta business portfolio, WhatsApp Business Account, business phone number, and Meta app. Subscribe the app to the WABA `messages` webhook field.

Use this callback URL:

```text
https://hooks.junk-king.app/api/integrations/whatsapp/job-photos
```

Set a unique webhook verification token in both Meta and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. The route verifies every POST with Meta's `X-Hub-Signature-256` HMAC before recording any message.

The system-user access token needs WhatsApp business messaging access so the worker can retrieve inbound media. Store it in macOS Keychain rather than the repository:

```sh
security add-generic-password -U -a missioncontrol -s opscenter-whatsapp-access-token -w
```

## Production environment

Add these non-placeholder values to `/Users/missioncontrol/Library/Application Support/OpsCenter/production.env`, keeping the file mode `0600`:

```sh
WHATSAPP_META_APP_SECRET_BASE64='base64-encoded Meta app secret'
WHATSAPP_WEBHOOK_VERIFY_TOKEN='long random verification token'
WHATSAPP_PHONE_NUMBER_ID='Meta phone number ID'
WHATSAPP_GRAPH_API_VERSION='current supported Graph API version, for example vNN.0'
WHATSAPP_TRUCK_PHONE_MAP_BASE64='base64-encoded JSON object mapping E.164 sender phones to Truck numbers'

# Required for OpsBot form prompts and confirmations. Prefer Keychain service
# opscenter-whatsapp-access-token when this environment value is omitted.
WHATSAPP_ACCESS_TOKEN_BASE64='base64-encoded Meta system-user access token'

# Optional safety tuning
WHATSAPP_CONTEXT_MAX_AGE_MINUTES='10'
WHATSAPP_GPS_MAX_AGE_MINUTES='30'
WHATSAPP_MAX_JOB_DISTANCE_MILES='0.5'
WHATSAPP_MINIMUM_JOB_MARGIN_MILES='0.15'

# Wait for a quiet period after the most recent inbound photo before confirming
# a verified explicit-JK photo batch. Upload and verification time counts toward
# this window instead of starting another full wait afterward.
WHATSAPP_JOB_PHOTO_BATCH_QUIET_SECONDS='3'
```

Example decoded truck map shape (use real values only in the private environment, never Git):

```json
{
  "15045550101": "Truck# 8",
  "12255550102": "Truck# 12"
}
```

## Worker installation

After deploying the release and installing the Playwright Chromium revision expected by that release, install the dedicated worker:

```sh
cd /Users/missioncontrol/opscenter-v2/opscenter
./deploy/macmini/install-whatsapp-photo-worker.sh
```

The worker reads the durable spool at `data/integrations/whatsapp-job-photos` unless `WHATSAPP_JOB_PHOTO_STATE_DIR` overrides it. Queue records and downloaded media are mode `0600`. An explicit JK number is resolved and validated on its own JunkWare appointment page, so it does not need to be on the message day's schedule. The worker then uploads through the authenticated JunkWare browser session and verifies that the exact appointment's media count increased before marking an item complete.

Krewe expense transactions and the outbound reply queue live under `OPSBOT_DATA_DIR/integrations/whatsapp-crew-expenses` unless `WHATSAPP_CREW_EXPENSE_STATE_DIR` overrides it. Text messages can receive an idempotent `Recorded.` receipt. Image messages never receive an individual receipt: after every explicitly matched photo for a job has uploaded and been verified in JunkWare, the inbound photo queue for the same sender, receiving number, and Chicago job date is drained, and the configured quiet period has elapsed since the most recent inbound photo, OpsBot sends exactly one batch confirmation to the sender. Upload and verification time counts toward that quiet window, so it does not add a second full delay after JunkWare verification. Complete Fuel and Dump messages enter a durable transaction queue; they are not exposed as OpsCenter Finance records yet.

### OpsBot job-closeout shadow mode

Krewe members can send `Closeout` to receive a bare fill-in list containing only JK number, truck load, bedload, items, credit-card fee, discount, tip, start time, end time, and payment. They can also start a draft with an exact command such as `Close JK4051234`. OpsBot only accepts a JK number found exactly once on today’s or yesterday’s schedule, and the sender phone must be mapped to the same truck through `WHATSAPP_TRUCK_PHONE_MAP_BASE64`.

The closeout draft accepts natural, multi-message details but requires one line per priced item. Quantities greater than one must use `@`, `each`, or `per` so OpsBot never guesses whether the amount is a unit price or a line total. The catalog mirrors JunkWare’s current Other Charges list:

- Labor
- Refrigerator
- Mattress/Box Spring
- Tire
- E-Waste
- Misc
- Sofa/Couch
- Sleeper Sofa/Couch
- Commercial Refrigerator
- Hot Tub
- Piano
- Freon Appliance
- Microwave
- TVs/Electronics
- Gas Surcharge
- CC Surcharge (Card Present), 3.00%

Truck load, bedload, discounts, tips, category, actual start/end time, and each payment are itemized separately. A Credit Card payment requires the card-present surcharge line; the surcharge is rejected without a Credit Card payment. Payments must reconcile exactly to the computed job total, or to the job total plus the entered tip.

When the draft reconciles, OpsBot returns an itemized `SHADOW CLOSEOUT` preview and accepts the exact confirmation `CONFIRM JK…`. Both the preview and confirmation are deliberately non-writing: this first release cannot modify JunkWare. Durable drafts live under `OPSBOT_DATA_DIR/integrations/whatsapp-job-closeouts` unless `WHATSAPP_JOB_CLOSEOUT_STATE_DIR` overrides it. The shadow-confirmed records provide the evidence needed to validate real Krewe wording before a separately reviewed write path is enabled.

The expense worker enforces this order:

1. Create a JunkWare Accounting → Truck Records line item with a deterministic OpsBot receipt number.
2. Re-read that truck ledger and verify the receipt number, category, and exact amount.
3. Send a terse notification to the truck's Slack channel and require Slack's success timestamp.
4. Publish the expense record to OpsCenter Finance and send the detailed WhatsApp verification, including a simple `EDIT` option for a correction request.

Retries resume from the saved stage. A deterministic JunkWare receipt number prevents a retry from inserting the same WhatsApp expense twice, and Slack's `client_msg_id` prevents duplicate alerts. If JunkWare or Slack is unavailable, the transaction stays out of OpsCenter until the missing verification succeeds.

Queue directories are `incoming`, `processing`, `completed`, `review`, and `failed`. A failure before JunkWare submission can retry up to three times. A failure during submission is treated as an uncertain outcome and moved to review to prevent duplicate customer photos.

WhatsApp confirmation waits for unfinished photos from the same normalized sender, receiving WhatsApp number, and Chicago job date. Captionless images remain a blocker because they may belong to that sender's batch. Photos from other senders or dates cannot hold up a verified batch. This check reads both `incoming` and `processing` inside the confirmation function; it does not replay or discard orphaned uploads, whose JunkWare outcome may be uncertain.

Verified WhatsApp receipts use a three-second inbound quiet window by default.
The worker checks receipts every second while uploads and ancillary Slack/expense
requests are awaiting the network, and immediately after each photo completes.
One outbox drain runs at a time; failed messages are attempted at most once per
worker cycle. The existing outer worker waits five seconds between cycles, so an
idle worker can still add that pickup delay. No extra provider polling is added.
Uploads retain exact-JK and increased-media-count checks; bounded source lanes
and their final audit are described below.
Slack's separate batch timer is unchanged. A new photo after a confirmed batch
starts another batch; no timer can identify future photos that have not arrived.

For timing investigations, `receivedAt` normally holds Meta's webhook message
timestamp, not independently observed handset Send time. New records label
`timestampSource` as `provider` or `intake-fallback` when the provider time was
missing/invalid; older records cannot prove that distinction. `enqueuedAt`
records OpsBot intake.
Completed job-photo records include `timing.processingStartedAt`, `mediaReadyAt`,
`uploadStartedAt`, and `verifiedAt`; `outcomeAt` records durable completion.
The confirmation batch's `confirmationQueuedAt` is only an outbox enqueue.
The matching `whatsapp-crew-expenses/outbox-sent` record's `outcomeAt` and
`metaMessageId` prove provider acceptance, not handset delivery/read time.
Compare the original sender's chat timestamp when investigating a delay before
the webhook; a later intake timestamp cannot establish the original Send time.

### Immediate gallery update after JunkWare verification

JunkWare upload is the first step. The uploader captures newly added media URLs
from its existing before/after page reads and verifies the exact appointment
identity again after submission. This adds no navigation or provider request.
The completed receipt retains the resolved appointment ID, newly verified URLs,
and complete owning-appointment gallery with its own observation time. A newer
complete gallery replaces an older gallery, so photos removed in JunkWare are
not retained merely because an older collector snapshot still contains them.

Schedule can display those verified photos immediately without waiting for the
full collector. A local filesystem event on durable receipt publication wakes
connected screens through the existing authenticated `/api/desktop/events`
stream. It triggers a fresh gallery read; the existing 15-second screen polling
remains the fallback if the event stream is unavailable. No source upload waits
for a gallery read, browser refresh, Slack delivery, or WhatsApp confirmation.

Only completed, verified, increasing-media-count receipts for the exact JK and
appointment can supply new photos. URLs must be recognized JunkWare media for
that appointment, and duplicates are merged by canonical media URL. The receipt
bridge lasts at most 30 minutes; a newer authoritative photo snapshot wins,
including a recorded deletion or empty gallery. A schedule-only snapshot cannot
claim to have refreshed photos. An audited gallery with unknown observation time
does not accept an overlay. Overall collector freshness remains collector-owned.
Full-gallery receipts require every URL to pass appointment/media validation,
an exact unique count, and inclusion of the newly uploaded photo. Invalid or
partial snapshots cannot remove existing photos. Receipt publication time must
not be substituted for gallery observation time.

The external daily collector must retain `photo_observed_at` from immediately
before each appointment-detail navigation, paired with that page's photos.
The end-of-run `collection_timestamp` can be later than uploads that the page
never observed and must not override that per-gallery timestamp. Install the
reviewed source migration from a task checkout with
`python3 scripts/install-junkware-photo-observation.py` (dry run), followed by
the same command with `--apply`. It pins reviewed source hashes, preserves a
private backup and refuses source drift. It does not collect or restart any
service; future existing collection cycles use the new source. Validate with
`python3 scripts/test-junkware-photo-observation.py`.

## Slack receipt notifications

When a sender supplies an explicit JK number in the image caption or in a recent text message, the worker can notify the appointment's assigned `#truck-N` channel after the full photo batch has been added. Each photo is tracked as pending until JunkWare verifies its upload. Once every photo in the JK batch is verified and no additional photo arrives for 60 seconds, OpsCenter sends one summary containing the JK number, photo count/categories, and an OpsCenter link. It does not include the sender phone number or customer data. A batch without a mapped physical truck falls back to `SLACK_WHATSAPP_PHOTO_CHANNEL_ID`, then `#ops-dispatch`.

The notification outbox is durable and de-duplicated by WhatsApp message ID. Failed Slack deliveries retry with backoff without delaying or repeating the JunkWare upload. The worker reads the same protected `slack.env` file as the existing OpsCenter alert publisher and loads the bot token from Keychain.

Enable the feature in `/Users/missioncontrol/Library/Application Support/OpsCenter/slack.env`:

```sh
SLACK_OPSCENTER_ALERTS_ENABLED=true
SLACK_WHATSAPP_PHOTO_NOTIFICATIONS_ENABLED=true
SLACK_WHATSAPP_PHOTO_BATCH_QUIET_SECONDS=60
SLACK_WHATSAPP_PHOTO_CHANNEL_ID='C0BNRMD25AS'
SLACK_TRUCK_8_CHANNEL_ID='C0BPMSJ7V43'
```

Configure every active `SLACK_TRUCK_N_CHANNEL_ID` as shown in `.env.slack.example`. The fallback channel defaults to `SLACK_OPS_DISPATCH_CHANNEL_ID` when `SLACK_WHATSAPP_PHOTO_CHANNEL_ID` is omitted.

To include the verified photos in the grouped Slack notification, add `files:write` to the Slack app, reinstall it in the workspace, update the protected Keychain bot token if Slack rotates it, and set `SLACK_WHATSAPP_PHOTO_ATTACHMENTS_ENABLED=true`. This uses Slack's external upload flow and stores a second copy of each customer photo in Slack. Keep the flag off until the reinstalled token passes a scope check.

## Verification

```sh
npm run verify:whatsapp-job-photos
npm run verify:whatsapp-crew-expenses
npm run verify:whatsapp-job-closeouts
npm run lint
npm run build
```

For the live acceptance test, send a JPEG or PNG from one mapped truck phone with an explicit test-safe JK number in the caption. Confirm the signed webhook queues it, the worker reports a verified upload, JunkWare shows one new photo on the intended appointment, and OpsCenter reflects the verified image through its event stream without waiting for the authoritative collector cycle.

After upload, a temporary or unexpected POST response must not trigger another
upload. If its identity does not match, the uploader reads the previously
verified appointment once and checks the exact origin, appointment path, unique
appointment ID and JK title again. It then requires an increased image count and
new media URLs belonging to that appointment. A failed read-back remains uncertain;
sanitized identity diagnostics describe the mismatch without exposing page data.
Existing uncertain receipts may be reconciled only against exact message-derived
filenames on the owning JunkWare appointment. Preserve the original outcome and
read-back evidence, and never invent an observed per-photo count increase or
repeat an upload simply to obtain confirmation.

The worker claims photos in local intake order (`enqueuedAt`, then provider
timestamp and filename), with at most 100 attempts per cycle. Up to
32 uncomplicated explicit-JK photos may be in preparation or awaiting upload.
The existing downloader runs at most four concurrent media acquisitions; it
keeps the same inbox, host, size, signature and checksum checks and shares each
message's success or failure without extra requests or background retries.
Recycling, resale, truck-load and ambiguous contexts wait for active photo work
and retain sequential processing. Retried files wait for another worker cycle.

Ready originals for the same exact appointment, JK and category may share one
native JunkWare upload. Groups contain at most five files and 4.5 MiB total; one
existing valid file up to 5 MiB may upload alone. Three independent source sessions
may upload groups concurrently for the same exact job and category. Each session
has one writer; another job or category waits for all current writes and their
final audit. The sessions retain authenticated cookies but acquire separate
ASP.NET session cookies so the server session lock cannot serialize their requests.
Only the first lane persists shared browser state; other lanes keep it private.
Persistence uses a private temporary file and atomic rename so another lane or
resolver cannot read a partially written authentication file.
Original photo bytes remain unchanged; no resizing or recompression is allowed.

The first queued original immediately prepares the three authenticated appointment
pages, concurrently with a 500 ms initial collection window. Group membership is
selected only after both finish, allowing downloads to fill capacity during browser
startup rather than freezing a tiny group first. Preparation reuses the initial
GET each uploader already requires. Failed preparation holds that target for the
cycle without retries. Subsequent idle grouping waits 100 ms; ready groups dispatch
as a lane becomes available.
The oldest ready photo starts each group; smaller ready photos
for the same job can fill remaining capacity around a larger photo, without
crossing a different job or category. The uploader blocks gallery image, media
and font downloads: source forms, scripts, identity and exact media URLs remain
available for verification without repeatedly downloading existing photos.
Identity and category are checked before submission, and every
individual message hash must appear exactly once in newly observed owning-job
media. One POST serves the group. A partial success publishes only exact proven
files and holds the rest as uncertain; it never repeats the group automatically.
A failed navigation gets one read-only reconciliation, never another POST.
Before resolving any successful file in a concurrent group of work, all its
writes settle and one authenticated owning-appointment GET checks the exact JK
and every successfully uploaded message hash again. Each successful receipt gets
the same final complete gallery, observed at the audit GET's start, so slower
intermediate responses cannot overwrite newer gallery contents. Missing files or
failed final identity checks remain uncertain; the audit never promotes an
uncertain upload or resubmits a POST. New files arriving during the audit wait for
the next group of work. Processing records remain pending until this audit ends,
which prevents early confirmations and preserves crash-recovery boundaries.
Complete-gallery receipts then update OpsCenter and release one confirmation.

Receipts retain per-photo processing/media-ready times, `uploadQueuedAt`, the
actual group's `uploadStartedAt`/`submittedAt`, `batchSize`, gallery observation,
and verification times. `batchBytes` records the sum of original file sizes in
that POST. `postNavigationCompletedAt` is recorded only when native POST navigation
completes successfully. When reconciliation reads the owning appointment,
`readbackStartedAt` and `readbackCompletedAt` bracket that GET; these fields are
absent if no GET occurs. A navigation failure recovered through source read-back
has GET timings but no successful POST-navigation timestamp. These observations
separate source upload response time from owning-gallery read-back without
adding requests or changing verification/retry behavior.
`finalAuditStartedAt` and `finalAuditCompletedAt` separately record the one added
read-only audit after concurrent source writes finish.

The operating acceptance target is at most 30 seconds
from provider send time to source verification, OpsCenter visibility and reply
acceptance for a normal batch with an identified job. Mocked concurrency and
partial-success tests do not establish that live latency; measure a real batch.
Missing identity or source outages must be reported honestly, never called a
successful upload to satisfy a deadline.

A pending confirmation also checks held/failed photos within ten seconds of its
photo timestamps from the same sender and receiving inbox. Explicit other jobs,
resale/recycling and older unrelated holds do not block it. A matching hold
produces one review notice and retains the pending verified total. When held
photos are explicitly resolved and verified, one final combined success total
replaces the old split-success behavior. This check does not assign an unknown
job, alter frozen context, or replay held or uncertain uploads.

### A JK number sent immediately after an album

WhatsApp may deliver an album's images before the separate job-number message.
A fresh standalone JK message can therefore identify one immediately preceding
unassigned photo burst from the same sender and receiving inbox. This exception
is bounded by provider timestamps and refuses conflicting job context, ambiguous
bursts, alternate workflows and any prior assignment or upload uncertainty.
Image captions do not act as standalone trailing messages.

A burst can contain both normally captured job context and later bindings. They
are consistent only when they reference the exact same text message ID and sole
JK number, with no conflicting caption, assignment or alternate workflow. This
allows an earlier missing-context hold to recover after a later image already
captured that same text, without changing processing or assigned records.

The association is stored separately with the exact text message and original
context. The normal queue claim applies it; an already-processing record is never
rewritten by the webhook. An eligible missing-context review can return to the
queue through an exclusive, non-overwriting publication. Existing completed,
processing or failed records prevent duplicate publication. A photo held earlier
in the current worker cycle gets one attempt with its newly validated binding;
that attempt counts toward the same cycle limit, and unchanged retries cannot
loop. The explicit job
still goes through the normal appointment identity and source verification path.
