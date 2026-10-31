# Agent handoffs and review

OpsCenter work moves between agents through files, not chat history. A planner
writes a brief, a builder implements it in a task worktree, and a different
model reviews what comes back. Independent review is optional under T'Jean's October 31, 2026 release policy.
When requested, independent review is performed by a different model family.
A builder may self-check, but must not call that independent review.

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
/Users/missioncontrol/opscenter-v2/vault/Tasks/<task>/brief.md and handoff.md, follow docs/agent-handoffs.md, \
and write the review receipt to /Users/missioncontrol/opscenter-v2/vault/Tasks/<task>/review.md." \
  --allowedTools "Read,Grep,Glob,Write,Bash(git diff:*),Bash(git log:*),Bash(npm run verify:*)"
```

Codex reviewing a Claude branch:

```sh
cd /Users/missioncontrol/opscenter-v2/worktrees/<task>
codex exec "Review this branch against origin/production. Read \
/Users/missioncontrol/opscenter-v2/vault/Tasks/<task>/brief.md and handoff.md, follow docs/agent-handoffs.md, \
and write the review receipt to /Users/missioncontrol/opscenter-v2/vault/Tasks/<task>/review.md. Do not edit \
source files."
```

The builder may start the reviewer itself as its last step, but must not edit
`review.md`. Blocking findings go back to the builder, who pushes fixes and
updates `handoff.md`; the reviewer then adds an addendum for the new commits.

GitHub pull request review (Claude Code Review, `@codex review`) is an
alternative once task branches reach `production` through pull requests.
Hosted review that bills an API key is metered usage and needs spending
approval first; see [spending controls](spending-controls.md).

## Optional review audit

A receipt or waiver is no longer required to merge or deploy. T'Jean removed
mandatory release review on October 31, 2026. `ship.sh` and the installed
production controller no longer invoke the receipt checker. CI, validation,
release authorization, production lineage, locking, spending checks, migrations,
health checks and rollback remain required. Explicit `claude-stop` labels still
stop shipping; resolve their findings before removing them.

`deploy/macmini/check-review-gate.py` remains available as an explicit audit
and as the parser for opted-in handoff-relay tasks. It reports missing review
coverage honestly and can return failure when an audit is requested. It is not
a pass-through stub and its result is not a mandatory release prerequisite.

An independent receipt names a reviewer from a different model family, the
exact reviewed head, and an `approve` verdict without open blocking findings.
The audit recognizes documented owner waivers and clean automatic merges.
Validation: `npm run verify:review-gate`.

The relay still completes reviews for tasks that explicitly opt in. Pending
optional reviews do not impose a global release gate. Do not start an optional
review merely to satisfy a removed requirement.

## Nightly digest

`deploy/macmini/vault-nightly-digest.py` runs at 23:30 on Mission Control and
writes `vault/Inbox/Digest <date>.md`: the active release, new production
commits, task notes and review verdicts, handoffs still waiting on review, new
deploy evidence, and memory notes changed that day. It links files instead of
copying their contents, reads only the local Git checkout without fetching,
and calls no external service. A person or agent
promotes what matters into `Decisions/` or `Lessons/` and deletes the digest.

Install it after the change is deployed, from the active release:

```sh
~/opscenter-v2/opscenter/deploy/macmini/install-vault-digest.sh
```

Validation: `npm run verify:vault-digest`. Slack, email, and call notes are not
read yet; each new source needs its own privacy review first.

## Handoff relay

`deploy/macmini/handoff-relay.py` moves opted-in tasks between Codex and Claude
without anyone starting the next step by hand. launchd runs it every two
minutes on Mission Control. Each run starts at most one step for one task and
exits; it never merges, deploys, or sends a message. Claude sessions still
cannot launch Codex themselves (Claude Code's auto mode blocks it); launchd
does the launch under rules the user installed.

A task opts in with a line in its brief, under the planner line:

- `Auto: codex-build`: Codex builds in `worktrees/<task>` on `codex/<task>`,
  Claude reviews, Codex fixes `changes requested` findings.
- `Auto: review`: someone else builds; the relay only starts the reviewer from
  the other model family once `handoff.md` names a head.

| Task files | Step the relay starts |
| --- | --- |
| Brief, no handoff (`codex-build`) | Codex build |
| Handoff head not named in `review.md`, builder Codex | Claude review (`claude -p`, Sonnet; Opus when the diff touches sending, money, payroll, auth, secrets, or deploy paths) |
| Same, builder Claude | Codex review, run inside the vault task folder so it cannot edit source |
| `changes requested`, builder Codex | Codex fix, which appends a handoff update with the new head |
| `changes requested`, builder Claude | Nothing: waits for the Claude thread |
| `approve` for the handoff head | Nothing: ready for the user to merge |
| Open questions, a failed or timed-out step, or anything unexpected | Nothing: needs the user |

Receipts are read with `check-review-gate.py` (opening-block review lines, different model families, exact `approve`, no open `[blocking]`), so a receipt the gate would reject never shows as ready. Only `Auto: codex-build` tasks may be built or fixed by the relay.

A stop before the agent has started leaves a cancel marker; the runner checks it before it launches anything, so no agent runs. If a runner never publishes itself, the lock stays and the task is marked; after confirming with `ps` that no codex or claude process is running, remove `task-evidence/handoff-relay/lock` by hand. The relay never deletes a lock it did not take, and never on a guess.

Guardrails: the relay does nothing unless `vault/Tasks/.relay-on` exists
(delete it to stop new steps), holds one lock for one running step, allows at
most 3 reviews per task, has no daily agent-run cap, ends a step's whole process group (SIGTERM, then SIGKILL) after 60
minutes and keeps the lock until the group is confirmed gone, and never retries a failed step. Claude runs in restricted/safe mode with only Read/Grep/Glob tools, no MCP,
no customization settings, and an allowlisted environment. A subscription login
(Pro/Max, first-party OAuth) and the private `.claude-subscription-only` confirmation
are required. Managed policy or an unknown login stops the step. No API fallback.
The reviewer reads a generated committed-source snapshot, not runtime links or
uncommitted work, and returns a structured receipt. The relay validates the exact
head and verdict before publishing review.md; old receipts remain in task-evidence.
The snapshot cannot run tests, so review cites builder evidence and says what it
could not independently execute. Each decision
is one line in `task-evidence/handoff-relay/relay.log`, and each task folder
gets a `relay.md` with its state.

```sh
python3 deploy/macmini/handoff-relay.py --dry-run   # print the next step; writes and launches nothing
python3 deploy/macmini/handoff-relay.py status
python3 deploy/macmini/handoff-relay.py stop        # kill the running step, halt its task
python3 deploy/macmini/handoff-relay.py reset <task>
```

Install it after the change is deployed and the user has approved it, from the
active release; it stays idle until the switch file exists:

```sh
~/opscenter-v2/opscenter/deploy/macmini/install-handoff-relay.sh
```

Validation: `npm run verify:handoff-relay`.

### Shared entry points and quota fallback

Codex reads AGENTS.md; CLAUDE.md points Claude at the same file. Both start from
the current task checkout and private task packet. The local Mission Control Home
points to the active release for current reference documentation; the integration
checkout may contain unfinished historical work and must not be reset to sync it.

The user confirmed on October 23, 2026: no Claude extra usage. If Claude exhausts
its included allowance, Codex continues building and testing other opted-in tasks.
Claude reviews wait until the reported reset time, or one bounded hourly probe
when the response does not provide a parseable reset. Daily run counts are informational and never block builds or reviews. No busy
retries and no paid provider substitution.
A Codex-only self-check is never described as independent cross-family review.

To record the user's account-setting confirmation, write a dated note to
`vault/Tasks/.claude-subscription-only`. This records confirmation; it cannot
change or independently enforce the Claude account's extra-usage setting.
Removing that file prevents new Claude calls. Removing `.relay-on` prevents all
new steps; use `stop` to end an already running step.

A task is complete only after its authorized commit is released, service health is
checked, and an authenticated browser check verifies the affected behavior.
The relay ends at review readiness; it does not grant deployment authority.

Builder boundaries (task branch only, no merge/deploy/messages) are agent
instructions inside the Codex workspace sandbox. The relay is not a Git server
permission boundary. Production still requires the separately installed lineage, spending and
deployment controls. Claude snapshot confinement is enforced by the
installed CLI's restricted file tools, with customizations and MCP disabled.

### Example: a documentation task from claim to close

Consider fictional task `docs-index-example-20261023`, which adds one missing
link to `docs/Home.md`. Its packet lives in `vault/Tasks/docs-index-example-20261023/`;
release evidence belongs in `task-evidence/docs-index-example-20261023/verification.md`.
The files use the brief, handoff and review receipt formats above; the states
below describe progress, not extra status fields to add to those receipts.

| Stage | Expected files and state |
| --- | --- |
| Claim | The planner writes `brief.md` with the goal, scope, checks, chosen base and no open questions, then adds `Auto: codex-build` under the planner line. The relay assigns one Codex builder in `worktrees/docs-index-example-20261023` on `codex/docs-index-example-20261023`; `relay.md` shows `State: Codex building`. |
| Build | Codex adds the link, runs `git diff --check`, commits and pushes that branch, then writes `handoff.md` with `Builder: Codex · Branch: codex/docs-index-example-20261023 @ <full SHA> · Base: origin/production @ <base SHA>`, the change and check results. `review.md` is still absent; `verification.md` has no release evidence yet. |
| Review | The relay starts Claude and updates `relay.md` to `State: Claude reviewing`. Claude's `review.md` opening block names `Reviewer: Claude · Builder: Codex · Reviewed: codex/docs-index-example-20261023 @ <full SHA>`, followed by `## Verdict` and `## Findings`. A review is acknowledged only when it names the current committed handoff head; a successful process exit or an older receipt is insufficient. |
| Correct | If the verdict is `changes requested` with a blocking broken-link finding, the relay starts Codex fixing. Codex corrects the link, reruns the check, commits, pushes and appends the new head and evidence to `handoff.md`. Claude reviews that new head and supplies a matching receipt or addendum; the old approval cannot cover it. |
| Ready | With `approve` for the current head and no open blocking findings, `relay.md` shows `State: ready for T'Jean`. The relay stops at review readiness; it never merges, deploys or sends messages. |
| Close | After separately authorized integration and release, the release owner records the released commit, service-health result and authenticated browser result in `verification.md`. Only then is the task complete and eligible for the documented retention workflow. A build-only handoff remains ready for review/release, not shipped. |

With `Auto: review`, the builder is assigned outside the relay; that mode only
launches a reviewer after `handoff.md` names the committed head. For a manual
takeover of either mode, first read `relay.md`, stop the owned step with the
relay's `stop` command and verify its processes have ended before editing.

If Claude hits its subscription quota, review pauses until reset (or the bounded
probe described above). Codex builds and tests can continue on other opted-in
tasks. Claude paid extra usage and API fallback stay off; a Codex self-check does
not replace Claude's review.
