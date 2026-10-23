# Review and learning workflow

Use one evidence packet to connect the original request, implementation,
review, acceptance and lesson. This is a local engineering workflow. It does
not create AI sessions, invoke providers, deploy, import lessons or alter the
installed spending/deployment controllers. The packet checker validates recorded
evidence and source identity; it is not an enforced production gate.

## Before implementing

Write a short brief with the problem, desired observable behavior, boundaries,
acceptance criteria, risk and recovery approach. Search canonical docs and
relevant OpsWiki history; record the entry IDs and what was checked. If no
relevant lesson exists or the library is unavailable, record that explicitly.
History supplies leads, never current verification or authority to replay actions.
Keep the private brief outside Git and carry it into the review packet.

## Prepare the handoff

Commit the intended source in the task worktree and run the appropriate checks.
Use the original task base, not HEAD or an arbitrary recent commit. Create the
packet in a private evidence folder outside the checkout:

```sh
python3 scripts/task-review.py init --base <full-base-sha> \
  --task 'Describe the task' --builder '<builder-session-id>' \
  --packet /absolute/private/task-review/packet-v1.json
```

Fill `brief` from the original request. State each observable acceptance criterion
as a distinct string. Record validation rows as
`{ "check": "description", "status": "passed", "head": "full-sha", "evidence": "report path or reference" }`.
Include failures and checks not run while work is incomplete; they intentionally
prevent a prepared pass. For documentation-only changes, link and instruction
checks can be sufficient. Do not add meaningless tests merely to fill the packet.

```sh
python3 scripts/task-review.py check --packet /absolute/private/task-review/packet-v1.json
```

The output gives a `subject` fingerprint covering the brief, exact source diff
and validation. Dirty/untracked source, a changed commit, an unrelated base or
an empty diff prevents a prepared pass. Ignored runtime files and dependencies
are not fingerprinted; record material environment information in check evidence.

## Review independently

For consequential changes (business writes, money, access, source authority,
deployment, automation or shared operational behavior), obtain a separate human
or separately authorized agent review. Give the reviewer the original request,
brief, base/head, actual diff, relevant prior lessons and test evidence. Ask them
to examine failure paths and omissions, not merely agree with the implementation.
The reviewer must inspect the actual evidence and record their own report.

A different model is optional; a distinct review with evidence is what matters.
If no separate reviewer is available, keep `review.verdict` pending and report
the gap. Do not invent a reviewer identity or call self-review independent.
Minor reversible documentation changes can receive proportionate self-checks,
but cannot claim the checker's independent `reviewed` status.

Record `review.reviewer` as the reviewer/session identity, `review.subject` as
the checked fingerprint, `review.evidence` as the report reference and `verdict`
as `approved` only after all findings are resolved. Every finding needs
`finding`, `status: "resolved"` and its resolution `evidence`; an empty list
means the reviewer found none. A new source commit, requirement or validation
record requires a new packet revision and fresh review of the changed scope.
Preserve prior packets and reports rather than silently replacing their history.

```sh
python3 scripts/task-review.py check --phase reviewed --packet /absolute/private/task-review/packet-v1.json
```

The tool checks distinct identity strings and evidence references, not identity
authentication or evidence truth. It cannot prevent someone from falsifying a
local file. File text is never executed. This supplements the existing release
process; it grants no spending, source-write or deployment permission.

## Accept the behavior and capture the lesson

Record one acceptance row per criterion with `criterion`, `status: "passed"`,
`head` and `evidence`. For application changes, distinguish the release marker,
service health and authenticated changed behavior. Passing tests or an approved
review alone does not establish deployment or live acceptance.

Fill `lesson` with summary, cause (including uncertainty), action, evidence,
remaining work, prevention and owner. Use `remaining: "None"` only when true.
Choose `outcome` from `fixed`, `follow-up`, `open`, `unknown` or `context`.
Record actionable prevention: a check, boundary or diagnostic step, not a
generic instruction to be more careful. Track remaining work with an owner and
task/issue reference when possible.

```sh
python3 scripts/task-review.py check --phase accepted --packet /absolute/private/task-review/packet-v1.json
python3 scripts/task-review.py lesson --packet /absolute/private/task-review/packet-v1.json \
  --output /absolute/private/task-review/lesson-v1.json
```

The export is a **draft manifest**, not a verified OpsWiki entry. `fixed` and
`follow-up` exports require the accepted check; incomplete work can still export
an honest `open`, `unknown` or `context` lesson. Use the existing
[OpsWiki import workflow](second-brain.md#import-or-extend-the-private-library),
starting with a dry run. Review source dates, privacy, field lengths and conflicts
before applying. That importer is the authoritative schema validator and preserves
manager edits. Nothing here automatically writes to the live knowledge store.

For subsequent work, search the lesson, verify that its conditions still apply,
and link the relevant evidence in the next brief. If an older conclusion is
wrong, name the superseded record and explain the new evidence rather than
silently erasing the earlier account.

## Reporting completion

Report what changed, the checks actually completed, independent-review status,
live acceptance where applicable, the lesson reference and outstanding work.
Use the specific stage reached; never describe a prepared packet as independently
reviewed or a local workflow change as a deployed application feature.
