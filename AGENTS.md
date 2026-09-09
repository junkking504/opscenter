# OpsCenter workspace instructions

Start with [docs/Home.md](docs/Home.md). It is the canonical human and agent
index for OpsCenter source, architecture, integrations, runtime boundaries,
sharing, and historical context.

## Source and deployment boundary

- Edit source in a Git checkout or task worktree based on the intended commit.
- Never edit `/Users/missioncontrol/opscenter-v2/opscenter`; it is the active
  immutable-production symlink.
- Never edit `/Users/missioncontrol/opscenter-v2/opscenter-preview`; it is the
  preview symlink.
- Follow [deploy/macmini/README.md](deploy/macmini/README.md) for delivery.
- A release, service-health check, and authenticated browser check are separate
  evidence. Do not claim production changed until all required checks pass.

## Production lineage

- `origin/production` is the only branch permitted to deploy to Mission Control
  production. Feature and task branches must be integrated into it first.
- Before updating `production`, read the active Mission Control SHA and require
  the proposed production commit to contain it. If production moved, merge the
  new active SHA and rerun validation.
- Production deployments must use `deploy/macmini/deploy-from-macbook.sh`. It
  invokes the controller installed outside release snapshots at
  `/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control/deploy-release.sh`.
- Never pipe or execute a task branch's `deploy-release.sh` directly. Never
  bypass the installed controller or its deployment lock.
- Manual rollback is a separate, explicitly authorized operation. Do not move
  `origin/production` backward or deploy a non-forward commit as a workaround.

## Task storage lifecycle

- Reuse one task worktree per task; additional copies need a concrete reason.
- When finished, stop only the temporary preview servers this task started.
- After shipping and verifying the task, run the installed retention command
  from outside its worktree with `--apply --scope worktrees --complete <path>`.
- Keep local changes and unshipped commits. Do not force removal or delete Git
  branches to satisfy a storage budget.
- Follow [Workspace retention](docs/workspace-retention.md) for commands,
  seven-day paused-task cleanup, release retention, and skipped-item reports.

## Runtime boundary

OpsCenter intentionally keeps runtime state outside Git:

- OpsBot collectors and authoritative data:
  `/Users/missioncontrol/.openclaw/workspace/opsbot`
- Protected environment and Slack configuration:
  `/Users/missioncontrol/Library/Application Support/OpsCenter`
- Logs: `/Users/missioncontrol/Library/Logs/OpsCenter`
- Browser profiles, Keychain values, databases, and launchd state remain local.

Do not copy credentials, cookies, tokens, customer records, employee payroll,
financial exports, raw telemetry, logs, or live runtime data into this
repository or a Business share bundle.

## Documentation

Update the relevant document in `docs/` when changing architecture,
integrations, source precedence, deployment, operational safety, or the asset
map. Prefer links to one canonical document over duplicated instructions.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
# Spending approval

Read `docs/spending-controls.md` before adding an external service, provider SDK,
AI call, paid feature, background polling, or changing request volume. A request
to implement or deploy a feature and the presence of credentials do not approve
new usage charges. Obtain explicit approval of provider, feature and maximum
spend before enabling a new metered path. Never raise limits, restore Google
Maps billing, remove spending gates, or update the externally installed spending
allowlist as part of a routine deployment. Tests must mock paid providers.
