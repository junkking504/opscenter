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

## Review gate

A task branch is not merged into `origin/production` until
`vault/Tasks/<task>/review.md`:

1. names a reviewer that is a different model from the builder,
2. reviews the exact commit being merged (a later push needs a new review, or
   an addendum: another `Reviewer: … · Builder: … · Reviewed: <branch> @ <sha>`
   line for the new head), and
3. has the verdict `approve` with no open `[blocking]` findings.

Agreement between agents is not evidence. The review checks the diff and the
recorded check results; the `verify:*` scripts and the post-deploy release,
health, and browser checks still decide whether the change works.

The user may waive the gate for a specific change. Record the waiver in
`review.md` as `Verdict: waived by <user>, <date>, <reason>`.

The installed production controller enforces the gate, so every launcher
copy, old or new, goes through it. After its forward-ancestry check and under
the deployment lock, `deploy-release.sh` runs
`deploy/macmini/check-review-gate.py` against `vault/Tasks/*/review.md` on
Mission Control. Every commit between the active release and `origin/production`
must be contained in a commit that an approved or waived receipt names.

- Review lines count only in the receipt's opening block, before the first
  `##` section, and only in the full `Reviewer: … · Builder: … · Reviewed:
  <branch> @ <sha>` form. Every review line in a receipt must name the same
  reviewer and builder, and the reviewer must be a different model family.
  Names map to a family by keyword (Anthropic: Claude, Opus, Sonnet, Haiku,
  Fable; OpenAI: Codex, GPT, ChatGPT; Google: Gemini), so "GPT-6 Codex" cannot
  review "Codex". A name with no known family, or more than one, is rejected. One
  self-reviewed or malformed line rejects the whole receipt.
- A waiver must read `waived by <user>, <YYYY-MM-DD>, <reason>`.
- A two-parent merge needs no review of its own only when its tree is exactly
  what `git merge-tree` produces automatically. A conflict resolution or any
  other change made in a merge needs a receipt naming the merge commit.

A refused deployment lists the unreviewed commits and the skipped receipts. The
gate takes effect when the controller is reinstalled from a `production` commit
that contains it; until then the installed controller is unchanged. Reviewer
names are written by the agents, so the gate prevents mistakes and skipped
reviews, not deliberate forgery. Validation: `npm run verify:review-gate`.

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

Guardrails: the relay does nothing unless `vault/Tasks/.relay-on` exists
(delete it to stop new steps), holds one lock for one running step, allows at
most 3 reviews per task and 6 agent runs per day, ends a step's whole process group (SIGTERM, then SIGKILL) after 60
minutes and keeps the lock until the group is confirmed gone, and never retries a failed step. Claude runs without API key or
Bedrock/Vertex variables, so they stay on the subscription login. Each decision
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
