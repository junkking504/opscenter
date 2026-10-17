# Agent handoffs and review

OpsCenter work moves between agents through files, not chat history. A planner
writes a brief, a builder implements it in a task worktree, and a different
model reviews what comes back. No change is graded by the agent that wrote it.

## Roles

| Role | Default agent | Owns |
| --- | --- | --- |
| Planner | Claude | Scope, the brief, acceptance checks |
| Builder | Codex | Implementation in a task worktree, the handoff |
| Reviewer | A different model from the builder | The review receipt |

The planner and reviewer may be the same agent. The builder and reviewer may
not. When Claude builds, Codex or another model reviews.

## Where the files live

Each task keeps its notes in the Obsidian vault on Mission Control, outside Git,
so they link to the decisions and lessons they produce. Logs and machine
receipts stay in `task-evidence/`:

```text
/Users/missioncontrol/opscenter-v2/vault/Tasks/<task>/
├── brief.md          written by the planner before work starts
├── handoff.md        written by the builder when the branch is ready
└── review.md         written by the reviewer

/Users/missioncontrol/opscenter-v2/task-evidence/<task>/
└── verification.md   release, health, and browser evidence, plus logs
```

`<task>` matches the worktree name, for example `waypoint-loading-20261007`.
These files follow the runtime boundary in [AGENTS.md](../AGENTS.md): they may
cite commits, files, and check names, but never credentials, customer records,
payroll, financial exports, or raw logs. Keep each file short; link to logs and
receipts instead of pasting them. When a task produces a decision or lesson
worth keeping, write it as its own note in the vault's `Decisions/` or
`Lessons/` folder and link it from the handoff; see
[OpsWiki](second-brain.md#publishing-from-the-obsidian-vault).

## Brief

```markdown
# Brief: <task>

Planner: <agent>  ·  Date: <YYYY-MM-DD>  ·  Base: origin/production @ <sha>

## Goal
One paragraph in the user's words: what should be different when this ships.

## Scope
- In: files, surfaces, or integrations the builder may change.
- Out: what must not change.

## Acceptance checks
- The `verify:*` scripts, tests, and browser checks that decide "done".

## Constraints
- Spending: new metered usage? (default: none; see spending-controls.md)
- Deploy: build only, or deploy after review? (default: build only)
- Governing spec or decision, if any.

## Open questions
- Anything the builder must not guess. Empty if none.
```

## Handoff

```markdown
# Handoff: <task>

Builder: <agent>  ·  Branch: <branch> @ <sha>  ·  Base: origin/production @ <sha>

## What changed
Short list of behavior changes, then the files touched.

## Checks run
| Check | Result | Notes |
| --- | --- | --- |
| npm run verify:<name> | pass/fail | Same failures on base? |

## Not done or not checked
Anything skipped, deferred, or that the builder could not run.

## Reviewer focus
The two or three places the builder is least sure about.
```

## Review receipt

```markdown
# Review: <task>

Reviewer: <agent>  ·  Builder: <agent>  ·  Reviewed: <branch> @ <sha>

## Verdict
approve | changes requested | blocked

## Findings
- [blocking] file:line — what is wrong and why.
- [non-blocking] file:line — suggestion.

## Checked against
Brief acceptance checks, the OS Constitution, spending controls, and the
runtime boundary. List any check the reviewer re-ran.
```

## Requesting a review

Run the reviewer from the task worktree after `handoff.md` exists. The
reviewer reads the brief, the handoff, and the diff, and writes `review.md`.

Claude reviewing a Codex branch:

```sh
cd /Users/missioncontrol/opscenter-v2/worktrees/<task>
claude -p "Review this branch against origin/production. Read \
vault/Tasks/<task>/brief.md and handoff.md, follow docs/agent-handoffs.md, \
and write the review receipt to vault/Tasks/<task>/review.md." \
  --allowedTools "Read,Grep,Glob,Write,Bash(git diff:*),Bash(git log:*),Bash(npm run verify:*)"
```

Codex reviewing a Claude branch:

```sh
cd /Users/missioncontrol/opscenter-v2/worktrees/<task>
codex exec "Review this branch against origin/production. Read \
vault/Tasks/<task>/brief.md and handoff.md, follow docs/agent-handoffs.md, \
and write the review receipt to vault/Tasks/<task>/review.md. Do not edit \
source files."
```

The builder may start the reviewer itself as its last step, but must not edit
`review.md`. Blocking findings go back to the builder, who pushes fixes and
updates `handoff.md`; the reviewer then adds an addendum for the new commits.

GitHub pull request review (Claude Code Review, `@codex review`) is an
alternative once task branches reach `production` through pull requests.
Hosted review that bills an API key is metered usage and needs spending
approval first; see [spending controls](spending-controls.md).

## Review gate

A task branch is not merged into `origin/production` until
`vault/Tasks/<task>/review.md`:

1. names a reviewer that is a different model from the builder,
2. reviews the exact commit being merged (a later push needs a new review or an
   addendum covering the new commits), and
3. has the verdict `approve` with no open blocking findings.

Agreement between agents is not evidence. The review checks the diff and the
recorded check results; the `verify:*` scripts and the post-deploy release,
health, and browser checks still decide whether the change works.

The user may waive the gate for a specific change. Record the waiver in
`review.md` as `Verdict: waived by <user>, <date>, <reason>`.

The gate is a workspace rule today. The deploy controller does not yet check
for a receipt; adding that check is a separate, explicitly authorized change to
the installed controller.
