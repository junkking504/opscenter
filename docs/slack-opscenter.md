# OpsCenter Slack alerts

OpsCenter checks operational alerts during each live-data refresh cycle, including failed source-refresh attempts so data-health incidents can still reach Slack. The normal interval is five minutes, with faster retries while a source is unavailable. Slack is the action and escalation layer; OpsCenter remains the source of truth.

## Initial alert set

- New or cancelled same-day appointment -> the assigned `#truck-N` channel
  - Unassigned or unknown trucks fall back to `#jobs-no`, `#jobs-br`, or `#jobs-ns` by territory
  - Unknown or unsupported territories fall back to `#ops-dispatch`
- Confirmed truck arrival -> that truck's `#truck-N` channel
- Clocked-in employee without a truck -> `#ops-dispatch`
- Employee clock-in, clock-out with hours, and finalized daily-pay breakdown -> `#ops-command` (or `SLACK_OPS_CREW_CHANNEL_ID`)
- Newly closed JunkWare job -> `#payment`, with each payment amount and method, check number for checks, card last four for cards, and any tip
- Open out-of-service fleet issue -> `#ops-fleet`
- New Linxup driving-safety event -> the corresponding `#truck-N` channel
  - Severe speeding, harsh braking, hard acceleration, harsh cornering, seatbelt warnings, tailgating, and collisions post as individual alerts
  - Ordinary speeding is grouped into one summary per truck after the local hour closes
  - Events without a supported physical-truck mapping fall back to `#ops-fleet`
- Red JunkWare or Linxup data health -> `#ops-data-health`
- Completed WhatsApp photo batch with an explicit JK number -> one summary with attachments in the assigned `#truck-N` channel after every photo is verified (when `SLACK_WHATSAPP_PHOTO_NOTIFICATIONS_ENABLED=true`); batches without a mapped truck fall back to `#ops-dispatch`

The first live run records existing appointments, existing cancellations, existing driving-safety events, and currently active incidents as its baseline. It does not flood Slack with pre-existing conditions. Later appointment additions, cancellations, and driving-safety notifications are each posted once; failed notification deliveries remain eligible for retry. Once a baseline incident clears, a later recurrence is treated as a new incident. New incident alerts are deduplicated, and recovery messages are posted in the original Slack thread.

Crew lifecycle notifications are also baselined once when the feature is first deployed. After that baseline, each employee receives at most one clock-in, clock-out, and finalized-pay notification per day. The messages are intentionally plain: clock-in states only that the employee clocked in; clock-out adds only hours worked; finalized pay lists total pay, hourly pay, tips, and bonuses.

Payment closeout notifications are baselined once when the feature is first deployed so existing completed jobs do not flood the new channel. After that baseline, each completed appointment is posted at most once. A completed record is held for retry until its closeout includes a payment line, which prevents an incomplete scrape from permanently omitting the requested payment details. Messages contain only the JK number, payment details, and a positive tip amount; they do not include customer data or a full card number.

Appointments that remain open after their scheduled window stay visible in OpsCenter but do not generate Slack alerts or resolution replies.

## Slack app setup

Create a dedicated internal Slack app from `deploy/slack/app-manifest.yml` and install it into the Junk King | Louisiana workspace. The manifest grants `chat:write`, `chat:write.public`, and `files:write`; the last scope is used only for explicitly enabled WhatsApp batch attachments. On the live Mac, store the bot token in macOS Keychain under service `com.opscenter.slack-bot-token` and account `opscenter`; the publisher reads it automatically. Invite the bot to any private channel it will use. Do not reuse or attempt to export the Codex Slack connector credential.

Copy `.env.slack.example` to `.env.slack.local` and set `SLACK_OPSCENTER_ALERTS_ENABLED=true`. Keep the bot token out of the file when Keychain is available.

## Verification

Preview current alerts without writing state or sending Slack messages:

```bash
npm run alerts:slack -- --dry-run
```

After configuring the bot token, run one live cycle manually. This safely establishes the appointment and incident baseline without sending pre-existing conditions:

```bash
set -a
source .env.slack.local
set +a
npm run alerts:slack
```

The live refresh loop runs the same publisher automatically after each successful data publish. Runtime state is stored at `data/slack/ops_alert_state.json` and is intentionally excluded from git.
