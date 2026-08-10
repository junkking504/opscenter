# OpsCenter Slack alerts and actions

OpsCenter checks operational alerts during each live-data refresh cycle, including failed source-refresh attempts so data-health incidents can still reach Slack. The normal interval is five minutes, with faster retries while a source is unavailable. Slack is the action and escalation layer; OpsCenter remains the source of truth.

## Initial alert set

- New same-day appointment -> `#ops-dispatch`
- Clocked-in employee without a truck -> `#ops-dispatch`
- Appointment still open after its scheduled window -> `#ops-dispatch`
- Open out-of-service fleet issue -> `#ops-fleet`
- Red JunkWare or Linxup data health -> `#ops-data-health`

The first live run records both existing appointments and currently active incidents as its baseline. It does not flood Slack with pre-existing conditions. Once a baseline condition clears, a later recurrence is treated as a new incident. New incident alerts are deduplicated, and recovery messages are posted in the original Slack thread.

## Slack app setup

Create a dedicated internal Slack app from `deploy/slack/app-manifest.yml` and install it into the Junk King | Louisiana workspace. The manifest grants only `chat:write` and `chat:write.public`. On the live Mac, store the bot token in macOS Keychain under service `com.opscenter.slack-bot-token` and account `opscenter`; the publisher reads it automatically. Invite the bot to any private channel it will use. Do not reuse or attempt to export the Codex Slack connector credential.

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

## Operations Action Center

Every non-dry-run alert cycle also reconciles the current Slack-backed signals into
`data/actions/ops_actions.json`. The Action Center on the daily dashboard is the
authoritative work queue. Each record has a stable action ID, current status,
owner, source-health state, timestamps, and an append-only event history.

Operators can acknowledge, snooze for one hour, mark handled, or reopen an
action. “Handled” means a person completed the immediate operational response;
it does not claim that the source condition cleared. Incident actions move to
“Resolved” only after a later alert cycle verifies that the underlying condition
is gone. If it recurs, the same action is reopened with a new history event.

The action store is written with atomic replacement and mode `0600`. Set
`OPSCENTER_ACTION_STORE_FILE` only when a deployment needs to override its
default shared-data location.

## Interactive Slack controls

The app manifest configures Slack interactivity at:

```text
https://hooks.junk-king.app/api/integrations/slack/actions
```

The webhook hostname remains restricted by middleware to the signed JunkWare
webhook routes and this Slack callback route. Slack requests must carry a valid
HMAC signature and a timestamp no more than five minutes old. An optional
`SLACK_TEAM_ID` check can restrict callbacks to the intended workspace.

Keep interactive controls off until all of these steps pass:

1. Update the dedicated OpsCenter Slack app from `deploy/slack/app-manifest.yml`.
2. Put `SLACK_SIGNING_SECRET` in the protected OpsCenter production environment.
3. Optionally put the workspace ID in `SLACK_TEAM_ID`.
4. Put `SLACK_OPSCENTER_ACTIONS_ENABLED=true` in both the protected web-server
   environment and the collector's private Slack environment. The web server
   accepts callbacks; the collector adds buttons to new messages.
5. Restart only the OpsCenter web service so it receives the protected values,
   then validate a signed callback in a controlled test.
6. Run one explicitly authorized live alert cycle and restart the collector only
   when that cycle reports `failed=0`.

No button writes to JunkWare, QuickBooks, payroll, fleet records, or customer
messaging. This phase changes only the OpsCenter action ledger. The
`SLACK_OPSCENTER_ACTIONS_ENABLED` flag is the kill switch: when false, callbacks
return unavailable and newly published alerts contain no state-changing action
buttons.
