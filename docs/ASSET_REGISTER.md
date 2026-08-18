# OpsCenter Asset Register

This register identifies the canonical location, edit policy, and sharing
classification for OpsCenter materials on Mission Control.

## Shareable and editable

| Asset | Canonical location | Edit policy | Business sharing |
| --- | --- | --- | --- |
| Application source | `/Users/missioncontrol/opscenter-v2/repository` | Edit on a branch/worktree | Share through the private Git repository or sanitized source archive |
| Product and operating docs | `repository/docs` | Edit with the related change | Safe after review; included in the Business bundle |
| Deployment source | `repository/deploy` and `repository/launchd` | Edit in Git; deploy through documented workflow | Share internally; contains paths but no secret values |
| Integration source in the app | `repository/lib`, `repository/app/api`, and `repository/scripts` | Edit in Git | Share internally through Git |
| Business project context | `repository/business-share` | Keep concise and secret-free | Designed for Business workspace upload |
| Durable OpsCenter continuity | `/Users/missioncontrol/Documents/Codex/OPSCENTER_MEMORY.md` | Verified facts only; no secrets | Curate before sharing; do not upload automatically |

## Local operational source

| Asset | Canonical location | Edit policy | Business sharing |
| --- | --- | --- | --- |
| OpsBot collector and processor scripts | `/Users/missioncontrol/.openclaw/workspace/opsbot/scripts` | Live operational source; change and validate deliberately | Do not bulk-upload; migrate to version control in a separate collector project before broad collaboration |
| OpsBot launchd source | `/Users/missioncontrol/.openclaw/workspace/opsbot/launchd` | Operational service configuration | Internal review only; exclude machine state and credentials |
| OpsBot docs and prompts | `/Users/missioncontrol/.openclaw/workspace/opsbot/docs` and `prompts` | Edit in place until collector migration | May be curated into Business context after review |
| Top-level refresh wrappers | `/Users/missioncontrol/.openclaw/workspace/opsbot/*.sh` and selected `.py` files | Live operational source | Do not copy blindly; many historical backups coexist |

Collector code remains in its current runtime location because changing the
collector executable paths is an operational migration, not a documentation
move. The local workspace launcher exposes the current source for access while
the repository remains the canonical home for the OpsCenter application.

## Machine-local runtime: never share wholesale

| Asset | Location | Why it remains local |
| --- | --- | --- |
| Authoritative OpsBot data | `/Users/missioncontrol/.openclaw/workspace/opsbot/data` | Customer, employee, payroll, finance, appointment, GPS, and integration state |
| Dispatch crew notes | `/Users/missioncontrol/.openclaw/workspace/opsbot/data/job-crew-notes/notes.json` | Dispatch-authored appointment instructions and their audit metadata; retain as protected operational state |
| Production environment | `/Users/missioncontrol/Library/Application Support/OpsCenter/production.env` | Protected configuration and credential references |
| Slack runtime configuration | `/Users/missioncontrol/Library/Application Support/OpsCenter/slack.env` | Channel/configuration state; token remains outside Git |
| Logs | `/Users/missioncontrol/Library/Logs/OpsCenter` | May contain operational identifiers and error context |
| Browser profiles and cookies | Local application-support paths | Authenticated sessions and personal data |
| Keychain entries | macOS Keychain | Credentials and API secrets; presence checks only |
| Active database/runtime state | Protected local service paths | Operational source of truth, not project documentation |

## Generated and historical material

| Asset | Location | Policy |
| --- | --- | --- |
| Active production | `/Users/missioncontrol/opscenter-v2/opscenter` | Immutable symlink; inspect, never edit |
| Active preview | `/Users/missioncontrol/opscenter-v2/opscenter-preview` | Immutable symlink; inspect, never edit |
| Production releases | `/Users/missioncontrol/opscenter-v2/releases` | Generated immutable builds; do not upload or hand-edit |
| Preview releases | `/Users/missioncontrol/opscenter-v2/preview-releases` | Generated immutable builds; do not upload or hand-edit |
| Task worktrees | `/Users/missioncontrol/opscenter-v2/worktrees` | Temporary branch checkouts; commit useful changes, then remove through normal Git workflow |
| Pre-Git/preview backups | Timestamped folders under `/Users/missioncontrol/opscenter-v2` | Historical recovery material; not a source of truth |
| Codex task history | Local Codex state plus durable memory summaries | Use for provenance; promote durable facts into repository docs |

## Ownership rule

Every material item must have exactly one canonical owner:

- Git owns application source, reviewed documentation, tests, and deployment
  definitions.
- OpsBot runtime owns live collector execution and authoritative generated data.
- macOS protected storage owns secrets and environment configuration.
- Immutable release trees own deploy artifacts only.
- Business share bundles are generated views, never sources of truth.
