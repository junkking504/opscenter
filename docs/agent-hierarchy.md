# Agent hierarchy and ownership

Command → Monitor exposes the live hierarchy to managers and administrators.
The operations and engineering branches have separate responsibilities. The
registry in `desktop-ui/lib/agent-hierarchy-contract.ts` assigns all 27 primary
tabs to named roles. Display tabs may share a specialist. Page heads supervise
their specialists, and Command supervises both leads. Nine truck identities
remain children of Convoy; visit tracking and unload/cost remain shared evidence
producers under Operations.

## What executes

The existing operational worker executes local rules, not model sessions.
It reads collected source-health evidence, nine truck assessments, the two
shared projections, maintenance incidents, and existing Control work items.
It does not collect from vendors, send messages, change business sources,
execute code repairs, deploy releases, or incur additional model usage.
Engineering roles own observed findings and acceptance requirements for scoped
engineering work; a monitoring heartbeat does not mean implementation occurred.
Tab coverage declares accountability and dependencies, not proof that every
possible business error or UI interaction has been checked.

The private state is `data/fleet/agent-hierarchy/state.json`. Each finding keeps
its existing source identity, one accountable agent, a proposed recipient,
review deadline and a durable assignment/handoff history. The receiver accepts
a policy-routed handoff only when it evaluates that finding and all its declared
dependencies are available. Until then the current owner remains accountable.
Repeated assessments do not repeat an accepted transfer. Human ownership and
source actions remain in the supporting Control, truck or maintenance record.
This is an oversight index, not a second executor or source-write queue.

Urgent findings have a 15-minute review deadline; next actions one hour; watch
items 24 hours. Overdue and unconfirmed findings escalate to the owner's parent,
and ancestor counts include all descendant work. A higher priority shortens the
deadline. These are review deadlines, not promised completion times. Disappearing
findings clear only on an available complete source read; missing, failed or
truncated sources preserve ownership as unconfirmed. Source-cleared does not
certify a repair. Reappearing conditions reopen with a new review deadline.
The cross-page API requires manager financial access because its evidence can
include finance and payroll work. GET performs no collection or state mutation.

## Runner isolation

`scripts/run-operational-agents.py` holds the permanent OS ownership lock and
runs shared, truck and hierarchy assessments in separate processes. Each has a
20-second deadline; a failure retains its projection and later stages continue.
A worst-case cycle is approximately 60 seconds plus startup. The existing lock
prevents overlapping cycles. No new scheduler or provider polling is added.
`data/fleet/agents/worker-status.json` records stage starts, results, durations,
exit codes and the last 20 failures using private atomic writes. Recent failures
remain assigned to Release for one hour after recovery; an intervening success
does not immediately hide them. A killed parent
leaves a visible running/stale stage rather than a fabricated success. The
hierarchy and existing truck views identify heartbeats over three minutes old.

An audit observed a transient timeout; a subsequent fresh-process input read
completed in under one second. Its original root cause was not established.
A production recurrence was captured during release activation, followed by
successful cycles and a 0.54-second independent input read. Host indexing was
busy, but contention was not proven as the exact cause. Stage timing and
isolation contain and identify recurrences without discarding
historical load baselines or increasing the individual stage deadline.

The minute collector uses launchd `ProcessType=Standard`, which retains light
resource limits, rather than the more restrictive Background classification.
Its local agent children maintain interactive dashboard freshness. Background
classification reproduced a slower input read (about 3.8 seconds versus 0.54
seconds normally); production samples showed CPU work in parsing/assessment.
The configured 60-second collection interval, network requests, ownership lock
and individual 20-second deadlines are unchanged. Other collectors retain
their existing scheduling policy. Final live cycles must separately verify
recovery; this scheduling correction does not prove every historical timeout
had the same cause.

## Reconciliation corrections

A named receipt within five minutes before the same truck's first recorded
arrival is an ambiguity, not a proven match. Both the actual and assumed records
remain, require review, and suppress the combined total. The actual amount and
physical unload time stay unchanged. Different trucks, facilities and receipts
outside this window do not become automatic matches.

Current degraded cost projections containing business exceptions remain readable
by truck agents. Retained, unavailable, error and regressed projections cannot
be represented as current evidence. Receipt-specific recommendations remain
visible alongside the underlying reconciliation records.

## Validation

`npm run verify:agent-hierarchy` covers exact audit regressions, all-tab ownership,
reporting cycles, single ownership, pending and accepted transfers, repeated runs,
overdue escalation, missing evidence, source clearance, reopening, clock rollback,
private durable persistence, access policy and timeout isolation. Existing dump,
truck, visit and role-access suites remain required. Production acceptance must
also open Command → Monitor, expand page/tab ownership and a finding's history,
and follow its link to the actual supporting record.
