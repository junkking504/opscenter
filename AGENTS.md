# OpsCenter repository rules

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
