# Sharing and Access

OpsCenter has two collaboration layers:

1. The private Git repository is the complete editable source collaboration
   surface.
2. The ChatGPT Business project is a curated context and discussion surface.

They complement each other; a ChatGPT Project is not a replacement for source
control or the Mission Control runtime.

## What to share

- The private Git repository with contributors who need to edit or review code.
- The generated Business context documents for teammates who need product,
  architecture, integration, and operating context.
- Specific reports or exports only after reviewing their audience and contents.

## What not to upload

- `.env*` files other than reviewed examples
- Keychain values, cookies, tokens, credentials, or browser profiles
- `data/`, customer/employee records, payroll, financial exports, telemetry, or
  appointment photos
- logs, databases, caches, `.next`, `node_modules`, build artifacts, releases,
  previews, worktrees, backups, or checkpoints
- the entire `/Users/missioncontrol/opscenter-v2` directory
- the entire OpsBot runtime directory

## Build the Business package

From a clean source checkout:

```sh
./scripts/build-business-share-bundle.sh
```

The builder performs tracked-file safety checks, creates a timestamped package
under `/Users/missioncontrol/opscenter-v2/business-share-output`, copies fewer
than 40 curated readable files, and creates an optional source archive. It does
not copy external runtime data or secrets.

Upload the readable files from the bundle to the ChatGPT Business project. Use
the private Git repository for complete source access and editing; the source
archive is for controlled transfer or backup, not the primary editing surface.

## ChatGPT Business project access

After the curated files are present, use the project Share control to invite
specific workspace members or a workspace group. Start with least privilege and
grant edit access only to people expected to change project materials. Review
the generated bundle before uploading because Business sharing is still a data
disclosure to the selected audience.
