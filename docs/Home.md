# OpsCenter Home

This is the canonical front door for OpsCenter. It brings together the product,
source, operational integrations, deployment model, history, and sharing rules
without mixing live runtime data or secrets into Git.

## Start here

| Need | Canonical location |
| --- | --- |
| Understand the product | [README](../README.md) and [OS Constitution](OPSCENTER_OS_CONSTITUTION.md) |
| Find a file or system | [Asset Register](ASSET_REGISTER.md) |
| Make a code or documentation change | [Editing and Releases](EDITING_AND_RELEASES.md) |
| Share with the Business workspace | [Sharing and Access](SHARING_AND_ACCESS.md) |
| Understand prior decisions | [Context and History](CONTEXT_AND_HISTORY.md) |
| Review architecture | [Platform Kernel Architecture](PLATFORM_KERNEL_ARCHITECTURE.md) |
| Work with an integration | Use the integration index below |

## Product and architecture

- [OpsCenter OS Constitution](OPSCENTER_OS_CONSTITUTION.md)
- [Platform Kernel Architecture](PLATFORM_KERNEL_ARCHITECTURE.md)
- [Operating Inbox vertical slice](OPERATING_INBOX_VERTICAL_SLICE.md)
- [Platform store ADR](adr/0001-platform-store-postgresql.md)
- [Original OpsCenter V2 specification](../OPSCENTER_V2_SPEC.md)

## Integrations and operating areas

- [Crew Pay Portal](crew-pay-portal.md)
- [Payment reconciliation](payment-reconciliation.md)
- [QuickBooks/Intuit production setup](qbo-intuit-production-setup.md)
- [SearchKings integration](searchkings-integration.md)
- [Google Reviews integration](google-reviews-integration.md)
- [Slack and OpsCenter](slack-opscenter.md)
- [WhatsApp job photos](whatsapp-job-photos.md)
- [LinxUp live GPS push](linxup-push.md)

## Canonical topology

```text
/Users/missioncontrol/opscenter-v2/
├── OPS_CENTER_HOME.md             local Mission Control front door
├── OpsCenter-Mission-Control.code-workspace
├── repository/                    canonical Git source checkout
├── worktrees/                     isolated task branches
├── opscenter -> releases/<sha>    active production; never edit
├── opscenter-preview -> preview-releases/<sha>
├── releases/                      immutable production builds
├── preview-releases/              immutable preview builds
└── business-share-output/         generated, sanitized bundles

/Users/missioncontrol/.openclaw/workspace/opsbot/
├── scripts/                       collector and processing source
├── docs/ and prompts/             collector documentation
├── data/                          authoritative runtime data; never share
└── .env*                          protected configuration; never share
```

The split is deliberate. Git is the collaboration and editing surface. Runtime
data and credentials remain outside Git. The local Home file and workspace
launcher make both areas easy to reach without moving or duplicating them.

## Current working rules

1. Start new work from the intended deployed/source commit in an isolated
   branch or worktree.
2. Keep documentation beside source in `docs/`.
3. Keep generated data, logs, caches, build output, credentials, and personal
   browser state out of Git.
4. Use the Business bundle builder for a curated share package; never upload
   the full Mission Control project directory.
5. Treat production, preview, and source as distinct until verified.
