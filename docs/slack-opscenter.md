# OpsCenter Slack alerts

OpsCenter checks operational alerts during each live-data refresh cycle, including failed source-refresh attempts so data-health incidents can still reach Slack. Confirmed LinxUp truck-arrival alerts are published separately by the one-minute LinxUp collector, immediately after visit matching. New appointments, reschedules, cancellations, and closeouts are checked by a persistent verified JunkWare schedule detector; it reads schedule pages only and does not wait for detail pages, GPS, payroll, QBO, Crew Portal, marketing, or VPS work. It uses one browser because JunkWare serializes concurrent logins, but publishes each market immediately after that market is verified instead of waiting for the other three. A sweep starts five seconds after the preceding sweep completes. With the normal all-market sweep near 45 seconds, this targets about 30 seconds average and less than 60 seconds maximum source-to-alert latency. Slack is the action and escalation layer; OpsCenter remains the source of truth.

## Routing policy

- New or cancelled same-day appointment -> `#jobs-no`, `#jobs-br`, or `#jobs-ns` by territory, regardless of truck assignment
  - New Orleans and Jefferson Parish -> `#jobs-no`
  - Baton Rouge -> `#jobs-br`
  - Denham Springs -> Baton Rouge / `#jobs-br`, even when an upstream record says Northshore
  - Northshore -> `#jobs-ns`
  - Unknown or unsupported territories -> `#dispatch`
- Confirmed truck arrival -> that truck's `#truck-N` channel, with JK number, customer name, and service address
- Newly closed job -> a short operational completion notice in that truck's `#truck-N` channel
- Fuel and dump receipts -> that truck's `#truck-N` channel
- Verified WhatsApp job-photo batch -> that truck's `#truck-N` channel
- LinxUp driving-safety events -> that truck's `#truck-N` channel
- Clocked-in employee without a truck -> retained in OpsCenter without a Slack alert because assignment normally follows closeout
- Employee clock-in, clock-out with hours, and finalized daily-pay breakdown -> `#ops-command` (or `SLACK_OPS_CREW_CHANNEL_ID`)
- Newly closed JunkWare job -> a separate finance detail in `#payment`, with each payment amount and method, check number for checks, card last four for cards, and any tip
- Open out-of-service fleet issue -> `#ops-fleet`
- Red JunkWare or Linxup data health -> `#ops-data-health`
- Cross-territory or unmapped operational exceptions -> `#dispatch`

Truck channels intentionally contain field execution events, not bookings or schedule changes. The territory jobs channels own appointment intake and cancellations so dispatch can see route-plan changes in one place. `#payment` keeps the finance detail while the truck channel receives only the operational closeout fact.

## Message format

OpsCenter-generated alert messages use the same compact scan pattern: an event icon and bold heading,
followed by one fact per labelled line. Alerts with a follow-up include `Next`
and an `Open in OpsCenter` link at the end. Closeouts use the fixed `Job Closed`
heading; the bold linked JK number follows directly, then `Load`, `Labor`, `CC 3%`,
`Tips`, `Total`, and payment facts as available. Load shows the price before its
size, a zero-value Tips line remains visibly labelled, and `Card Ending` contains
only the unbolded last four digits. This
keeps arrival, closeout, payment, crew, receipt, and verified-photo alerts
equally readable without changing their routing, delivery cadence, or deduplication.

Same-day appointments deliberately use a field-layout exception for dispatch
scanning: `New Appointment`, a linked JK number, appointment time, bold customer
name, a tap-to-call phone number, then address (with items following when present).
The linked JK number replaces the otherwise redundant `Open in OpsCenter` footer.

Cancellations use `Cancellation`, a bold linked JK number, appointment time,
customer, a tap-to-call phone number, address, then a bold `Reason` label. Known customer/contact/
address prefixes are removed from the supplied reason so the actionable
cancellation text is not repeated.

Truck arrivals use the matching field layout in their truck channel: `Truck N
On-site`, bold linked JK number, Chicago-local arrival time, customer, a tap-to-call
phone number, then address. Incoming Slack-style telephone links are converted to a
readable call link. This uses the confirmed LinxUp arrival time while enriching customer
contact information from the matching JunkWare appointment.

Verified WhatsApp photo batches use `Photos Uploaded`, a bold linked JK number,
the total photo count, then `Verified`. The formatted message is used both for
regular Slack posts and for the attachment upload comment.

The first live run records existing appointments, existing cancellations, and currently active incidents as its baseline. It does not flood Slack with pre-existing conditions. Later appointment additions and cancellations are each posted once; failed notification deliveries remain eligible for retry. Once a baseline incident clears, a later recurrence is treated as a new incident. New incident alerts are deduplicated, and recovery messages are posted in the original Slack thread.

Crew lifecycle notifications are also baselined once when the feature is first deployed. After that baseline, each employee receives at most one clock-in, clock-out, and finalized-pay notification per day. Clock-in identifies the crew member and time; clock-out adds hours worked; finalized pay lists total pay, hourly pay, tips, bonuses, and any other pay.

The first schedule-detector run also baselines silently, then posts each new appointment, reschedule, cancellation, and closeout once. It considers a scrape valid only after JunkWare has confirmed the requested date and all four markets, preventing partial results from creating false operational alerts. Truck closeout and payment-detail notifications are baselined independently when each feature is first deployed so existing completed jobs do not flood either channel. A payment detail is held for retry until its closeout includes a payment line, which prevents an incomplete scrape from permanently omitting the requested payment details. Messages contain only the JK number, payment details, and a positive tip amount; they do not include customer data or a full card number.

The same verified fast snapshot overlays the current OpsCenter Schedule roster when it is newer than the full collector output. The browser checks the combined freshness signal every five seconds, so status, type, total, payment method, truck, appointment additions, and cancellations do not wait for the multi-integration reconciliation cycle. The full collector remains authoritative for enriched closeout, crew, payment reconciliation, and historical details.

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
