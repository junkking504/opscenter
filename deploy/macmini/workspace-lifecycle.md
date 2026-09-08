<!-- BEGIN OPSCENTER STORAGE LIFECYCLE -->
## OpsCenter task storage lifecycle

- Use source checkouts under `worktrees/`; never edit the `opscenter` or
  `opscenter-preview` immutable-release symlinks. Read the selected checkout's
  `AGENTS.md` and `docs/Home.md` before editing.
- Reuse one working copy per task. Do not create extra full copies for each
  validation, minor follow-up, or deployment attempt.
- Record and stop only temporary preview servers started by the current task
  when that task finishes. Do not stop shared production/preview or other tasks.
- After the task's changes are shipped and verified, leave its directory and
  run:

  ```sh
  cd /Users/missioncontrol/opscenter-v2
  python3 '/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control/workspace-retention.py' --apply --scope worktrees --complete /Users/missioncontrol/opscenter-v2/worktrees/TASK
  ```

- Report a retained worktree and the cleanup tool's reason. Preserve unfinished
  changes, unpushed work, local files and Git branches. Never force-delete them
  to meet the 30 GB storage budget.
- The installed cleanup tool is the authorized lifecycle mechanism. Production
  retains current plus two rollback releases; preview retains current plus one.
  Idle worktrees retain source while generated dependencies/builds are eligible
  after seven days. Running processes and deployment locks always take priority.
<!-- END OPSCENTER STORAGE LIFECYCLE -->
