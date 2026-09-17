# Truck agents

OpsCenter assigns a persistent logical agent to Trucks 1 through 9. They assess
collected local evidence and present recommendations in Command and Convoy.
The same rules apply to every truck. A truck without one effective tracker
mapping stays in **Identity review**; appearing in dispatch choices does not
establish availability. No truck number, crew, repair, or live observation is
hard-coded into the rules.

## Responsibilities

Each agent follows daily inspections and outstanding restrictions, repair owners
and planned dates, scheduled service, recorded fuel, supported load, source
assignments, appointment windows and closeout/photo evidence. It recommends
capacity confirmation or disposal review and consolidates open work after 5 p.m.
Central. Historical values and missing data remain explicit. It does not predict
pickup volume, invent an ETA, certify a repair, or establish physical presence.

Command shows one primary recommendation per truck and the shared count of open
appointments without a physical truck. Expand a truck for all recommendations,
source times and history. Convoy uses the selected truck and also shows its agent
inside the truck record. Supporting links open existing schedule, inspection,
repair, service and load workflows. An acknowledged recommendation stays visible;
**Reopen review** reverses its review status without changing source records.

Dispatch remains the owner of cross-truck decisions. Source-verified assignment
transfers move responsibility between agents on the next observation. Pending
assignment overrides do not become source truth, and virtual assignments never
get silently claimed by an agent.

## Source and freshness rules

- Schedule uses the shared JunkWare row projection with independently verified
  market freshness. Current-day window and assignment decisions require an
  observation within two minutes. An ended window and open appointment mean
  progress needs checking, not that a visit was missed.
- GPS observation time is per truck. Current route position requires a point
  within three minutes, even when a parked device has a valid slower heartbeat.
- Inspections retain their actual observation time. A prior-day report does not
  satisfy today's inspection. Stop reports survive a new day or later clear
  report. Their disposition requires a resolved, non-deleted repair on the same
  truck whose source reference or resolution contains the exact inspection
  reference (`deviceId:requestId`, also accepted URL-encoded). The original report
  link provides this reference. Acknowledging an agent recommendation does not
  supply repair disposition.
- Load uses the existing operational load projection, preserving its uncertainty
  and reconciliation rules. A carried day-start is not a new physical observation.
  Recorded near-full loads prompt disposal review, not an automatic unload.
- Visits and expense exceptions consume the shared visit/unload agents. Each
  disposal record has a separate recommendation identity. Actual receipts resolve
  only their matched exception; duplicate/ambiguous receipts remain reviewable.
- Missing, corrupt, timestamp-regressed and unversioned replacements retain prior
  evidence as unavailable. Repair failure cannot erase a restriction. Worker
  heartbeats never refresh a source observation. Other source evidence continues
  to be processed independently.

Stored repair records are current retained records. A past-day selection is not
a reconstruction of the truck's mechanical condition on that date; the screen
labels this limitation.

## Execution and private state

The existing `run-operational-agents.py` owner lock and 20-second deadline cover
both shared agents and the nine truck projections. Existing LinxUp refresh/push
hooks run them while the UI is closed. Each group fails independently. There is
no additional daemon, provider polling, model call, metered service or external
notification. The normal immutable release restarts the existing release-bound
workers to pick up the code.

Private state lives under `data/fleet/truck-agents/`:

- `YYYY-MM-DD.json`: heartbeat, source observations, nine assessments and up to
  100 superseded recommendation versions per truck. Atomic fsync/rename under the
  existing OS worker lock prevents partial publication. Damaged history blocks
  replacement rather than being silently discarded.
- `reviews/<date>/<recommendation hash>/<revision>.json`: immutable review
  revisions with actor, request ID, fingerprint, review state and timestamp.
- `requests/<request ID>.json`: durable intent identifying the exact revision.

Recommendation IDs include date, truck, rule and source subject. Semantic versions
exclude mere collection heartbeats. New facts reopen review under a new version;
repeated ticks do not create duplicate exceptions. Superseded means the computed
recommendation changed, not that the underlying condition was proven resolved.

`GET/POST /api/desktop/truck-agents` uses the existing authenticated session,
operations-write permission, same-origin protection, bounded input, and private
no-store responses. GET computes a fresh local assessment while reporting the
background worker's separate heartbeat. This does not start a worker or refresh
a vendor. Failed screen reads retain the prior screen with stale/error wording.

`fleet.agent_review` is a Class 1 local action. Review publication follows the
existing knowledge store's immutable revision pattern: fsync a private temporary
file and exclusively hard-link the next revision. Concurrent editors cannot
overwrite one another. Request IDs bind actor and exact content. Exact retries
read the saved result without running the writer. **Check Saved Result** derives
success from the exact published revision, including after a lost response or
process restart; an unpublished intent remains pending. No crash leaves a review
lock behind. Source-change and version preflight failures publish no intent.

The agents do not move jobs, submit closeouts/payments, approve return to service,
buy anything, or contact crews/customers. Those actions remain in their existing
authorized workflows with their source read-back requirements. New paid AI use
requires separately approved scope and spending limits.

## Verification

`npm run verify:truck-agents` covers all nine roles, identity gaps, transfers,
source loss/regression, stale/future GPS, midnight restrictions, separate dump
visits, late receipt reconciliation, duplicate ticks, immutable inputs, private
persistence, actor-bound retries, stale reviews and saved-result recovery.

Also run dump/operational-agent, inspection-fleet and CSS regressions, both
TypeScript projects, targeted lint and the production build. The browser fixture
`desktop-ui/tests/truck-agents.html` uses synthetic records and local mocked writes.
Production acceptance separately checks the worker heartbeat and all nine roles,
Command expansion, Convoy selection, evidence links, acknowledgment/read-back and
reopening. No source-business write is needed for acceptance.
