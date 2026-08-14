# Editing and Releases

## Choose the correct surface

- Application or integration code: edit a Git branch/worktree from the intended
  base commit.
- Product, architecture, or runbook material: edit `docs/` in the same branch.
- Collector code under OpsBot: treat it as a separate live operational system;
  validate its service and data paths before changing it.
- Runtime data, logs, browser profiles, databases, and credentials: do not edit
  merely to reorganize the project.

## Never edit these paths

```text
/Users/missioncontrol/opscenter-v2/opscenter
/Users/missioncontrol/opscenter-v2/opscenter-preview
/Users/missioncontrol/opscenter-v2/releases/*
/Users/missioncontrol/opscenter-v2/preview-releases/*
```

The first two paths are symlinks to immutable release directories. A healthy
build in a release is not an editable checkout.

## Normal application workflow

1. Identify the currently intended source/deployed commit.
2. Create or use an isolated branch/worktree.
3. Make source and documentation changes together.
4. Run task-appropriate verification, TypeScript, lint, tests, and build.
5. Commit and push the exact intended source.
6. Use [the Mission Control deployment runbook](../deploy/macmini/README.md).
7. Verify release marker, the `com.openclaw.opscenter` LaunchAgent, local health,
   and the changed authenticated public behavior.

Do not restart collectors, tunnels, databases, the WhatsApp worker, or unrelated
services as a side effect of an application-only change.

## Documentation workflow

- Put durable product and technical knowledge in `docs/`.
- Put short navigation and ownership information in `docs/Home.md` and
  `docs/ASSET_REGISTER.md`.
- Link to existing material instead of copying it.
- Promote verified durable facts from task history into the relevant doc.
- Keep secrets and current operational records out of documentation.

## Collector migration direction

The OpsBot runtime contains current scripts plus many timestamped backups. A
future collector migration should:

1. Identify the exact launchd entrypoints in use.
2. Select only active source, tests, docs, and dependency declarations.
3. Put that source in its own version-controlled package or a deliberate
   `collectors/` package in this repository.
4. Exclude `data/`, `.env*`, checkpoints, browser state, logs, and backups.
5. Validate on a non-authoritative path.
6. Change launchd paths only in a separately approved operational cutover.

Until that cutover, the asset register—not a duplicate source copy—is the
central catalog.
