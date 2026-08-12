# OpsCenter Slack alerts

OpsCenter checks operational alerts during each live-data refresh cycle, including failed source-refresh attempts so data-health incidents can still reach Slack. The normal interval is five minutes, with faster retries while a source is unavailable. Slack is the action and escalation layer; OpsCenter remains the source of truth.

## Initial alert set

- New same-day appointment -> `#jobs-no`, `#jobs-br`, or `#jobs-ns` by territory
  - New Orleans and Jefferson Parish -> `#jobs-no`
  - Baton Rouge -> `#jobs-br`
  - Northshore -> `#jobs-ns`
  - Unknown or unsupported territories -> `#ops-dispatch`
- Clocked-in employee without a truck -> `#ops-dispatch`
- Open out-of-service fleet issue -> `#ops-fleet`
- Red JunkWare or Linxup data health -> `#ops-data-health`
- Completed WhatsApp photo batch with an explicit JK number -> one summary in `#ops-dispatch` after every photo is verified (when `SLACK_WHATSAPP_PHOTO_NOTIFICATIONS_ENABLED=true`)

The first live run records both existing appointments and currently active incidents as its baseline. It does not flood Slack with pre-existing conditions. Once a baseline condition clears, a later recurrence is treated as a new incident. New incident alerts are deduplicated, and recovery messages are posted in the original Slack thread.

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
