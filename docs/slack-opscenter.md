# OpsCenter Slack alerts

## Crew progress in Command

Command Alerts opens with operational updates grouped by truck and appointment.
Every appointment in the available Schedule snapshot remains visible, including
appointments that have not generated a Slack update. Each card shows its crew,
window, territory, latest update, recorded steps, and next required action.
The optional All updates view shows events newest first; each job's expanded
history runs first to latest. Search, truck selection, and Follow-up only are
local viewing controls. Reviewing an update never removes it from the history
or marks a crew step complete. Control retains the existing shared follow-up
workflow. The Operations Map follows the updates and keeps its existing controls.

Tracked evidence is truck assignment, confirmed arrival, uploaded photos,
recorded payment, JunkWare closeout, and confirmed departure. Photo presence is
not proof of before/after coverage; the application has no verified before/after
requirement contract. Missing photos are flagged only after closeout with an
available photo audit. Payment is recorded only with named tender(s), positive
payment covering the recorded total, and no remaining balance. Estimates do not
require payment. Settlement verification remains separate. A missing arrival
record means confirm crew status; it does not establish that the crew is late.
Departure requires an explicit confirmed visit exit, never disappearance of GPS.

Stale/unavailable sources retain recorded facts, but absent evidence becomes
Unknown rather than a new missing-step assertion. A partial Slack channel or
thread read is explicitly marked incomplete. Available source messages remain reviewable and can be linked to Control even
when other channels or replies are unavailable. Server-side source identity and
version checks still apply; unavailable source messages cannot be acted on. Empty history is not evidence that operational work is done.

Existing sentence-style crew clock-in/out and final-pay messages also use the
same event layout, preserving the member, recorded times, hours, and pay fields.
Their source action opens the corresponding operating day in Krewe.

Command and the Slack digest combine delivery retries using the original event
fingerprint while retaining the first source message ID, latest facts, and all
source message aliases. In-place Slack edits and changed event facts are labeled
Updated. An existing owned Control item takes precedence over a duplicate review
mark, with identical alias selection on server reads and writes. Existing work
items and source messages are not deleted. Distinct visit IDs, photo-batch IDs,
receipts, and thread replies remain separate. Legacy messages without an event
fingerprint are preserved because identical wording alone cannot prove a retry.
The existing Job Closed / Payment Recorded consolidation remains in place.

This change affects OpsCenter presentation and shared action lookup. It does not
change Slack posting, channel routing, notification cadence, or collector state.
Outbound duplication needs delivery-specific evidence before changing a publisher.

Local verification:

```bash
npm run verify:crew-progress
# In another terminal, run the isolated synthetic UI fixture:
cd desktop-ui
node node_modules/vite/bin/vite.js --config tests/refresh.vite.config.ts --port 3128
# From the repository root:
npm run verify:crew-progress:browser
```

The fixture is `/tests/crew-progress.html` on that local Vite server. It uses
synthetic records and simulated review/Control actions; it cannot write to
operational sources. This fixture is not included in the production entry point.

Command new-appointment tags reuse the Schedule territory color palette and
territory classification (including Westbank within Jefferson Parish).
New-appointment cards display their complete facts without a Details
toggle. Their badge includes the source appointment territory, with the territory
channel as a fallback when the appointment record is unavailable. Missing
territory is explicitly labeled. Uploaded JunkWare job photos appear as linked
thumbnails only on the Job Closed alert, outside its Details toggle, including
uploads collected after closeout. Other alerts for the same appointment do not
repeat the photos. Media uses the existing JunkWare URL
allowlist; private Slack download URLs are not exposed. Photo availability still
depends on the job collector having captured the upload.

OpsCenter checks operational alerts during each live-data refresh cycle, including failed source-refresh attempts so data-health incidents can still reach Slack. Confirmed LinxUp truck-arrival alerts are published separately by the one-minute LinxUp collector, immediately after visit matching. New appointments, reschedules, cancellations, and closeouts are checked by a persistent verified JunkWare schedule detector; it reads schedule pages only and does not wait for detail pages, GPS, payroll, QBO, Krewe Portal, marketing, or VPS work. It uses one browser because JunkWare serializes concurrent logins, but publishes each market immediately after that market is verified instead of waiting for the other three. A sweep starts five seconds after the preceding sweep completes. The production in-session sweep measured 17.2 seconds total and about 4.3 seconds per market, producing a roughly 22-second same-market read cadence before the five-second OpsCenter browser check. This targets about 30 seconds and keeps the operating requirement below 60 seconds. Slack is the action and escalation layer; OpsCenter remains the source of truth.

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
keeps arrival, closeout, payment, Krewe, receipt, and verified-photo alerts
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

The first live run records existing appointments, existing cancellations, and currently active incidents as its baseline. It does not flood Slack with pre-existing conditions. The fast schedule detector is the primary publisher for later appointment additions and cancellations. The full refresh is a fallback: it records the detector's successful delivery fingerprints and publishes only a change the detector did not deliver. If the full refresh delivers while the detector is unavailable, the detector records that shared fingerprint and does not repeat it when it recovers. Failed notification deliveries remain eligible for retry. Once a baseline incident clears, a later recurrence is treated as a new incident. New incident alerts are deduplicated, and recovery messages are posted in the original Slack thread.

Krewe lifecycle notifications are also baselined once when the feature is first deployed. After that baseline, each employee receives at most one clock-in, clock-out, and finalized-pay notification per day. Clock-in identifies the Krewe member and time; clock-out adds hours worked; finalized pay lists total pay, hourly pay, tips, bonuses, and any other pay.

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

The live refresh loop runs a focused closeout publisher immediately after the verified JunkWare snapshot succeeds, before optional QBO, Krewe Portal, marketing, or VPS work. It then runs the full publisher after the broader refresh. Both use the same durable closeout fingerprints, so the focused fallback, the fast schedule detector, and the full pass cannot duplicate a closeout. Runtime state is stored at `data/slack/ops_alert_state.json` and is intentionally excluded from git.


### Closeout and visit alerts (September 2026)

Job Closed owns the recorded payment and card-verification facts. The general
publisher no longer emits a separate Payment Recorded alert. OpsCenter groups
legacy closeout/payment messages by JK number, preserving the canonical closeout
message ID and its photos. A standalone payment remains visible until a matching
closeout exists. Job total, tips, and paid amount retain separate labels.

Card verification requires fresh `qbo-accounting-api` reconciliation evidence for
the same job, amount, card suffix (when recorded), and one unique matched QBO
transaction. Missing, stale, ambiguous, voided, or mismatched evidence never shows
as verified. These are read-only checks; no accounting adjustment is posted.

New closeout message receipts let the publisher update its original Slack message
in place when payment/QBO facts change. Main receipts live in `ops_alert_state.json`;
fast-detector receipts live in runtime `slack/closeout-receipts/` to avoid writing
across the detector's separate state lock. Older messages without saved receipts
are consolidated and enriched in OpsCenter; they are not blindly reposted.

Truck On-site is displayed as Arrival. Departure requires a confirmed visit with
an explicit exit timestamp after arrival, not loss of GPS. Existing departures
are baselined on first activation; subsequent departures use the same fast GPS
publisher with distinct visit fingerprints and retry deduplication.

Within an expanded job history or All updates, Command event facts are visible
inline. The truck/job card keeps current progress and next action visible before
opening the history; the condensed duplicate summary is omitted.
Photos appear only on Job Closed and Estimate Closed alerts, and in the closed
appointment’s Schedule record. Source and workflow action buttons remain
available without expanding an alert.

Completed job and estimate records and their closeout alerts show recorded on-site
time with arrival/departure clocks. The duration sums confirmed visit intervals,
merges overlapping observations, and excludes time away between visits. Missing,
ambiguous, or incomplete timestamps remain unavailable; an open visit awaits its
recorded departure. Departure alerts include the recorded duration as well.
