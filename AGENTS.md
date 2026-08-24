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

## Shared-worktree safety

- Treat every existing modification, staged change, untracked file, and commit as
  user-owned unless the current task created it.
- Do not run `git revert`, `git reset`, `git checkout --`, `git restore`, or any
  equivalent operation that removes or reverses work unless the user explicitly
  requests that exact destructive action.
- Before editing, record `git status --short --branch` and the current `HEAD`.
  Recheck both immediately before committing because other Codex tasks may use
  this checkout concurrently.
- Use an isolated Git worktree for implementation whenever the task may commit,
  build, or deploy. Integrate the finished change onto the current production
  lineage; never publish a stale snapshot from the task's starting point.
- Stage only the files or hunks owned by the current task. Never commit unrelated
  changes found in the shared checkout.

## Mission Control deployment safety

- Do not deploy or restart Mission Control without explicit user authorization.
- Before an authorized deployment, read the active release commit on Mission
  Control and require it to be an ancestor of the requested commit.
- Use `deploy/macmini/deploy-from-macbook.sh`; do not bypass its deployment lock
  or forward-only ancestry gate.
- `--allow-non-forward` is reserved for an explicitly user-authorized rollback.
  Never use it merely to make a rejected deployment proceed.
- If production moved while a task was in progress, merge or rebase the active
  release into the task branch, resolve the integration deliberately, rerun
  validation, and only then deploy.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
