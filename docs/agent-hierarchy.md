# Agent hierarchy and ownership

Command → Monitor exposes the live hierarchy to managers and administrators.
The operations and engineering branches have separate responsibilities. The
registry in `desktop-ui/lib/agent-hierarchy-contract.ts` assigns all 27 primary
tabs and five Waypoint crew flows to named roles. Display tabs may share a specialist. Page heads supervise
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

## Core source ownership

The Engineering branch includes a **Data manager** with four source specialists:
**JunkWare data**, **QuickBooks data**, **WEX data**, and **LinxUp data**. These
roles reuse the existing collectors, imports, source-health readers, timestamps,
and protected snapshots. They do not start a second collector, copy credentials,
open new provider sessions, or create another operational database.

Each source specialist owns the health and coverage finding for its source. The
Data manager aggregates those findings, preserves source-specific timestamps and
precedence, and owns coordination when sources disagree. It does not merge an
uncertain record into a fabricated fact. JunkWare appointment evidence,
QuickBooks accounting status, WEX posted-export coverage, and LinxUp telemetry
remain distinct even when a downstream workspace combines them.

WEX is explicitly a retained posted-transaction export, not a live portal read.
Its agent reports the last import and transaction coverage without polling WEX.
Other integrations, address recovery, and unclassified source failures remain
with **Other integrations and recovery** so the four core roles do not duplicate
existing responsibilities.

## Waypoint ownership

The **Waypoint reliability agent** reports to the Engineering lead and owns
phone/truck setup, inspection access, jobs, truck switching and closeout reliability.
It runs inside the existing minute hierarchy assessment, even while no manager
has Command open. The operational hierarchy keeps its durable findings and
escalates urgent items to Engineering after 15 minutes. Missing evidence
escalates immediately as unconfirmed; stale worker assessments remain visible.
The JunkWare data agent owns JunkWare source freshness, which is also a declared
dependency of Waypoint.

Eight concurrent, read-only loopback checks use the Waypoint hostname and HTTPS
proxy headers: the crew page, manifest and unauthenticated session, day, inspection,
current-job, switch-truck and closeout endpoints. Each has a three-second deadline,
a one-MiB response bound, and no redirect following. The page and manifest must
identify Waypoint; APIs must return the expected phone-setup 401. These probes
send no phone cookie and cannot fetch customer data or trigger source actions.
They verify origin routes and access boundaries, not public DNS/tunnel reachability
or complete authenticated phone interactions. Production checks only run with
the Mission Control runtime. No new scheduler, external polling, AI call or cost
is introduced, and the hierarchy stage retains its existing 20-second limit.

The agent also reads saved truck switches and crew closeout receipts across all
dates. An attention switch, a moving switch idle over five minutes, an uncertain
crew closeout, or a pending closeout over ten minutes becomes urgent owned work.
Each finding includes its saved reference and recovery instruction. Missing
inspection, a safety stop, an idle phone and ordinary in-progress work are not
service outages. Damaged/unreadable/oversized history is unavailable evidence;
it cannot clear earlier findings. Reads are capped at 10,000 receipts per ledger
and two MiB per receipt. The agent also checks the existing OpsBot setup approval and monthly allowance,
and flags each phone’s latest failed, uncertain or abandoned send. Provider
acceptance remains distinct from receipt on the phone. The agent never retries a switch or payment, changes
crew assignments, submits inspections, clears restrictions or deploys repairs.
Engineering acceptance must still verify the actual affected workflow.

In Command → Monitor, expand the Waypoint reliability agent, select its findings,
or open page/tab ownership and Source coverage to see its scope and checks.
`npm run verify:waypoint-agent` exercises failures, ownership, escalation,
read-only monitoring, corrupted evidence retention and source clearance using
isolated fixtures and mocked HTTP responses.

The hierarchy also reads the complete current schedule and local address evidence.
Every open appointment without a verified location, including unassigned jobs,
gets an urgent Dispatch-owned finding linked to that appointment. It escalates
to Control after 15 minutes. Canceled and completed records are excluded. Stale
or unreadable schedules/caches retain prior findings as unconfirmed; only a fresh
complete read can clear one.

The address research queue is a separate feed. Failed, paused or stalled recovery
and exhausted shared call/budget capacity produce one Integrations-owned finding,
escalating to Engineering. The 500-call limit is identified separately from the
dollar budget. Exhausted capacity remains a watch item even after current addresses
resolve. This oversight only reads existing evidence: it cannot spend, increase a
limit, retry paid research, or change the ledger.

The private state is `data/fleet/agent-hierarchy/state.json`. Each finding keeps
its existing source identity, one accountable agent, a proposed recipient,
review deadline and a durable assignment/handoff history. The receiver accepts
a policy-routed handoff only when it evaluates that finding and all its declared
dependencies are available. Until then the current owner remains accountable.
Repeated assessments do not repeat an accepted transfer. Human ownership and
source actions remain in the supporting Control, truck or maintenance record.
This is an oversight index, not a second executor or source-write queue.

The maintenance observer's `photo-review` finding routes to Control and opens
the Command photo-review queue. Held/failed photo records require source review;
they are not, by themselves, implementation defects. Existing assignments move
through the same dependency-gated handoff, preserving identity, history and
deadline without closing any photo record. Technical photo-processing delays
remain Engineering work.

The live state retains every open or unconfirmed finding and the 200 most recent
source-cleared findings. Older cleared findings move, under the same worker
lock, to immutable per-record files in
`data/fleet/agent-hierarchy/archive/YYYY-MM/`. Archive writes are fsynced before
the compact live snapshot is published and exact retries are idempotent. A
failed archive write leaves the prior live state untouched; compaction never
deletes active ownership or supporting source records.

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
The same file retains the latest 1,440 cycle samples for 24-hour percentile
checks. A stage taking at least ten seconds adds local-only child CPU, peak
resident memory and bounded input-record counts. Diagnostics never invoke a
collector or provider and do not extend the existing 20-second deadline.

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

The production build command gives its Next.js compiler a bounded 6 GiB V8
heap after a 4 GiB build-time allocation failure. This flag is on `npm run build`
only; the deployed `next start` process and worker deadlines are unchanged.

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
