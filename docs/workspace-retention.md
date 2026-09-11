# Workspace retention

OpsCenter keeps source and Git history while bounding generated dependencies,
compiled builds, and immutable release copies. The default workspace budget is
30 GB. It is an attention threshold, never permission to discard source or
terminate another task.

| Area | Policy |
| --- | --- |
| Production | Current release plus two rollback releases |
| Preview | Current preview plus one previous preview |
| Active tasks | One source worktree per task; reuse it for follow-ups |
| Paused tasks | Clear ignored dependencies/builds after seven days without activity |
| Completed tasks | Explicit completion checks production ancestry and local files before removal |

Running processes, locked worktrees, active release links and explicitly
protected rollback paths are always kept. A completed build is identified by its
release marker matching Git HEAD; it
becomes eligible as soon as it is superseded, even on the same day. Only
incomplete builds receive a 24-hour grace period. Older incomplete builds lose
generated caches but retain source, and do not consume a rollback slot. These
exceptions can temporarily exceed the counts; reports explain why. No process
is killed by the cleanup tool. Production rollback slots follow successful
deployment history and require an intact build and dependency inventory. Failed
builds and releases whose caches were partially cleared cannot displace a usable
rollback. Active releases remain protected regardless of those checks.

## One installed command

The reviewed helper is installed beside the production controller:

```sh
python3 '/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control/workspace-retention.py' --measure
```

The default is read-only. It records `last-check.json` under
`~/Library/Application Support/OpsCenter/workspace-retention/`, including each
candidate or skip reason, free space, measured workspace size and the budget
flag. To apply the approved policy, use `--apply`; the last applied results are
saved separately as `last-applied.json`. The helper does not follow runtime
symlinks or delete branches, secrets, personal files or unknown ignored files.

A paused task's source stays in place even when it contains unfinished edits or
unshipped commits. Only recognized, Git-ignored, untracked `node_modules`,
`.next*`, and `tmp/macmini-preview-next` build directories are disposable.
The ignored `public/desktop-assets` directory is also disposable when the
committed Vite configuration explicitly declares that output with `emptyOutDir: true`; tracked assets and undeclared directories remain protected. Reuse
requires `npm ci` in the relevant package directory and its normal build command.

## Finish a task

1. Reuse one worktree. Stop only preview processes owned by this task after QA.
2. Commit, ship, and verify the task according to the production workflow.
3. Change directory to `/Users/missioncontrol/opscenter-v2` and run:

```sh
python3 '/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control/workspace-retention.py' --apply --scope worktrees --complete /Users/missioncontrol/opscenter-v2/worktrees/TASK
```

Completion refuses to retire a task whose commits are not contained in the
active production release. Local changes, untracked files, unknown ignored
files or running processes keep the source worktree. Branches remain in Git.
For superseded previews only, the helper recognizes Next.js rewriting
`next-env.d.ts` import paths and adding preview type paths to `tsconfig.json`.
Only those exact generated edits can be restored before retirement; all other
configuration or source changes remain protected.
Task completion is explicitly initiated by the owning agent after live QA; the
daily monitor does not infer that a task is complete.

## Deployments and daily checks

The installed production controller applies production retention before a build
and after successful activation/restarts. Preview deployment applies preview
retention only after both runtimes and coexistence checks pass. Both share the
same deployment lock with manual cleanup. A cleanup error preserves files and
reports attention; it does not roll back a healthy application.

Refresh the reviewed installed controller with
`deploy/macmini/install-production-release-controller.sh origin/production` on
Mission Control. It also installs the helper and merges the versioned lifecycle
instructions into the workspace-root `AGENTS.md`, preserving unrelated content.
Installing these maintenance scripts does not deploy or restart the app.

The existing daily storage check runs the read-only measurement command. It
reports meaningful changes, new cleanup blockers, workspace size above 30 GB,
low free space, or Reolink log growth. It stays quiet for unchanged conditions;
it does not delete files or restart services.

## Safety checks

Run `npm run verify:workspace-retention` and the existing production lineage and
collector lifecycle checks when changing this mechanism. Tests use disposable
Git repositories and exercise active references, local/unpushed source, ignored
files, symlink targets, retention counts and deployment-lock contention.
