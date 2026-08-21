# OpsCenter Slack alerts

OpsCenter checks operational alerts during each live-data refresh cycle, including failed source-refresh attempts so data-health incidents can still reach Slack. Confirmed LinxUp truck-arrival alerts are published separately by the one-minute LinxUp collector, immediately after visit matching. New appointments, reschedules, and cancellations are checked by a dedicated verified JunkWare schedule detector. When that fast detector sees a job complete, it immediately reads that one JunkWare closeout record before alerting. Slack is the action and escalation layer; OpsCenter remains the source of truth.

## Routing policy

- New or cancelled same-day appointment -> `#jobs-no`, `#jobs-br`, or `#jobs-ns` by territory, regardless of truck assignment
  - New Orleans and Jefferson Parish -> `#jobs-no`
  - Baton Rouge -> `#jobs-br`
  - Denham Springs -> Baton Rouge / `#jobs-br`, even when an upstream record says Northshore
  - Northshore -> `#jobs-ns`
  - Unknown or unsupported territories -> `#dispatch`
- Confirmed truck arrival -> that truck's `#truck-N` channel, with JK number, customer name, and service address
- Newly closed job -> one full closeout alert in that truck's `#truck-N` channel, including the payment method, amount, and any tip; no alert is sent until those details are available
- Fuel and dump receipts -> that truck's `#truck-N` channel
- Verified WhatsApp job-photo batch -> that truck's `#truck-N` channel
- LinxUp driving-safety events -> that truck's `#truck-N` channel
- Clocked-in employee without a truck -> retained in OpsCenter without a Slack alert because assignment normally follows closeout
- Employee clock-in and one finalized clock-out breakdown per employee -> `#ops-command` (or `SLACK_OPS_CREW_CHANNEL_ID`)
- Open out-of-service fleet issue -> `#ops-fleet`
- Red JunkWare or Linxup data health -> `#ops-data-health`
- Cross-territory or unmapped operational exceptions -> `#dispatch`

Truck channels intentionally contain field execution events, not bookings or schedule changes. The territory jobs channels own appointment intake and cancellations so dispatch can see route-plan changes in one place. A closeout and its payment are one operational event, so both are sent together to the assigned truck channel.

The first live run records existing appointments, existing cancellations, and currently active incidents as its baseline. It does not flood Slack with pre-existing conditions. Later appointment additions and cancellations are each posted once; failed notification deliveries remain eligible for retry. Once a baseline incident clears, a later recurrence is treated as a new incident. New incident alerts are deduplicated, and recovery messages are posted in the original Slack thread.

Crew lifecycle notifications are also baselined once when the feature is first deployed. After that baseline, each employee receives at most one clock-in and one finalized clock-out notification per day. A clock-out waits for verified daily pay, then sends the employee's hours, hourly pay, tips, bonus, and total together in one standalone message.

All OpsCenter Slack alerts use the same compact presentation: a bracketed event heading, the job, truck, or employee on its own line, and aligned label/value rows in a monospace block. The `EOD Report` keeps its exact title and uses the same aligned rows.

The detector baselines silently on its first run and on the first verified snapshot of each new business date, then posts each new appointment, reschedule, and cancellation once. It publishes only after JunkWare has confirmed the requested date and every selected market. It never posts a schedule-only closeout. Instead, a newly completed job remains in its fast retry queue until the targeted closeout read contains a method and amount for every payment; it then posts the one full truck-channel alert and clears the item. Existing completed jobs are baselined so they do not flood Slack. Full closeouts include the payment method, amount, check number where applicable, card last four, and any tip. Messages contain only the JK number, payment details, and a positive tip amount; they do not include customer data or a full card number.

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
