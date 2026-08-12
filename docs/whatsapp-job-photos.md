# WhatsApp job photo intake

OpsCenter receives truck photos through Meta's official WhatsApp Cloud API and uploads them to the corresponding JunkWare appointment.

The desktop WhatsApp linked-device connection is useful for staff visibility, but it does not expose a supported inbound webhook. Production intake therefore requires the Operations number to be registered with a Meta WhatsApp Business Account and subscribed to the OpsCenter webhook.

## Matching policy

1. An explicit `JK` number in the image caption, or in a text message from the same sender during the previous 10 minutes, wins.
2. Without a JK number, the sender phone is mapped to a truck and OpsCenter uses that truck's GPS position at message time.
3. The nearest non-cancelled appointment is selected only when GPS is fresh, the truck is within 0.5 mile, and the next-nearest appointment is at least 0.15 mile farther away.
4. Missing mappings, stale GPS, excessive distance, ambiguity, unknown JK numbers, and uncertain upload outcomes go to the review queue. They are never auto-attached to a customer job.

The caption keywords `before`, `after`, `donation`, or `receipt` select the JunkWare image category. Photos without a category keyword default to `After`.

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

# Optional safety tuning
WHATSAPP_CONTEXT_MAX_AGE_MINUTES='10'
WHATSAPP_GPS_MAX_AGE_MINUTES='30'
WHATSAPP_MAX_JOB_DISTANCE_MILES='0.5'
WHATSAPP_MINIMUM_JOB_MARGIN_MILES='0.15'
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

The worker reads the durable spool at `data/integrations/whatsapp-job-photos` unless `WHATSAPP_JOB_PHOTO_STATE_DIR` overrides it. Queue records and downloaded media are mode `0600`. It uploads through the authenticated JunkWare browser session and verifies that the appointment's media count increased before marking an item complete.

Queue directories are `incoming`, `processing`, `completed`, `review`, and `failed`. A failure before JunkWare submission can retry up to three times. A failure during submission is treated as an uncertain outcome and moved to review to prevent duplicate customer photos.

## Slack receipt notifications

When a sender supplies an explicit JK number in the image caption or in a recent text message, the worker can notify `#ops-dispatch` after the full photo batch has been added. Each photo is tracked as pending until JunkWare verifies its upload. Once every photo in the JK batch is verified and no additional photo arrives for 60 seconds, OpsCenter sends one summary containing the JK number, photo count/categories, and an OpsCenter link. It does not include the sender phone number or customer data.

The notification outbox is durable and de-duplicated by WhatsApp message ID. Failed Slack deliveries retry with backoff without delaying or repeating the JunkWare upload. The worker reads the same protected `slack.env` file as the existing OpsCenter alert publisher and loads the bot token from Keychain.

Enable the feature in `/Users/missioncontrol/Library/Application Support/OpsCenter/slack.env`:

```sh
SLACK_OPSCENTER_ALERTS_ENABLED=true
SLACK_WHATSAPP_PHOTO_NOTIFICATIONS_ENABLED=true
SLACK_WHATSAPP_PHOTO_BATCH_QUIET_SECONDS=60
SLACK_WHATSAPP_PHOTO_CHANNEL_ID='C0BNRMD25AS'
```

The channel defaults to `SLACK_OPS_DISPATCH_CHANNEL_ID` when `SLACK_WHATSAPP_PHOTO_CHANNEL_ID` is omitted.

To include the verified photos in the grouped Slack notification, add `files:write` to the Slack app, reinstall it in the workspace, update the protected Keychain bot token if Slack rotates it, and set `SLACK_WHATSAPP_PHOTO_ATTACHMENTS_ENABLED=true`. This uses Slack's external upload flow and stores a second copy of each customer photo in Slack. Keep the flag off until the reinstalled token passes a scope check.

## Verification

```sh
npm run verify:whatsapp-job-photos
npm run lint
npm run build
```

For the live acceptance test, send a JPEG or PNG from one mapped truck phone with an explicit test-safe JK number in the caption. Confirm the signed webhook queues it, the worker reports a verified upload, JunkWare shows one new photo on the intended appointment, and OpsCenter reflects the new photo after the next authoritative collector cycle.
