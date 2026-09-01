# OpsBot Control

Status: Work, Dispatch, Fleet, Finance, Krewe, and Communications control foundation; production kernel activation pending

Route: Command `/?section=opsbot`

Companions: [OpsCenter OS Constitution](OPSCENTER_OS_CONSTITUTION.md), [Platform Kernel Architecture](PLATFORM_KERNEL_ARCHITECTURE.md)

## Product naming

OpsCenter is the product. OpsCenter OS remains the operating layer and shared
policy-controlled kernel. OpsBot is the AI operator identity. **OpsBot Control**
is the Command dashboard where people see what OpsBot observes, recommends,
and is allowed to do.

This separation keeps the language useful without implying that an agent owns
the business system:

- OpsCenter contains the authoritative operating experience.
- OpsCenter OS owns work state, action policy, verification, and audit.
- OpsBot observes approved context and may recommend or invoke only registered,
  policy-allowed actions.

## Complete control-system contract

OpsBot Control is intended to control OpsCenter through one governed lifecycle:

1. Observe fresh evidence from the correct source authority.
2. Explain the condition and propose a bounded next action.
3. Apply actor permission and action-risk policy.
4. Obtain a separate human approval when policy requires it.
5. Execute only a versioned, registered action with an idempotency key.
6. Verify the result against the authoritative OpsCenter state.
7. Preserve a sanitized audit event and recovery guidance.

The Operating Inbox UI is not a prerequisite. The control plane uses the shared
kernel work and action contracts directly. If the kernel is disabled, the same
Command surface remains useful and explicitly read-only.

## Implemented control packs

The work control pack provides the control spine and a real end-to-end action
path for OpsCenter work items:

- durable action runs, policy decisions, approvals, state transitions, and events;
- actor-aware permission checks and separation of requester from approver;
- idempotent command requests and authoritative read-back verification;
- a Command action console with work-item selection, action status, and audit summaries;
- direct controls to acknowledge, claim, snooze, and reopen work;
- approval-gated manual resolution with a required reason;
- current Jobs, Krewe, Fleet, Finance, Communications, and freshness observations without a second data authority;
- responsive desktop, tablet, and phone layouts.

The Dispatch control pack adds:

- a verified active-appointment roster from the complete JunkWare schedule;
- call-ahead commands with current-state conflict protection and read-back verification;
- truck assignment requests with stale-source and stale-local-state protection;
- risk-class 2 approval by a different manager or administrator before assignment;
- same-day hourly rescheduling through the existing JunkWare time-slot adapter, with
  current-time, truck, and local-version conflict protection;
- risk-class 2 approval and authoritative JunkWare read-back for time changes;
- cross-date moves with risk-class 3 approval, pre-write current-date/time checks,
  destination-slot validation, and post-save JunkWare date/time read-back;
- cancellation requests with a required reason, risk-class 3 approval, serialized
  JunkWare execution, and a verified cancellation receipt;
- reuse of the existing serialized JunkWare adapter and assignment verification path;
- a strict runtime guard: only `MISSION_CONTROL` may change shared Dispatch or JunkWare state;
- preview simulation receipts that prove policy and verification without writing route,
  call-ahead, cancellation, or JunkWare state.

The cross-date adapter is intentionally separate from truck assignment. A move changes
the scheduled date/time and verifies both fields in JunkWare; a truck-only change does
not produce a reschedule action.

The Fleet control pack adds:

- the existing Fleet repair queue, checklist results, and LinxUp review signals in one
  vehicle availability command surface;
- explicit `out of service`, `action required`, and `no active hold` states without
  presenting the latter as a mechanical safety certification;
- risk-class 3 out-of-service requests that create durable blocking repair records;
- risk-class 3 return-to-service requests that require a verified repair resolution;
- store and issue observation checks that reject stale approvals before a Fleet write;
- authoritative read-back of the repair record after execution;
- a guard that blocks return to service while any other out-of-service repair remains;
- a strict boundary that LinxUp telemetry and checklist signals are advisory and never
  change truck availability automatically;
- preview simulation receipts that leave the shared Fleet repair store unchanged.

The Finance control pack adds:

- an authorized Daily Close snapshot from Truck Records, JunkWare payments, QBO
  reconciliation evidence, manual bonuses, and payroll corrections;
- reconciliation status, exception count, source freshness, and difference shown inline
  without creating a second accounting authority;
- risk-class 3 manual bonuses and payroll corrections that require a different manager
  or administrator to approve;
- bounded amount and rate inputs, required evidence notes, and employee identity checks;
- store and record observations that reject an approval when a newer Finance change exists;
- authoritative read-back of the exact bonus or payroll correction after execution;
- a strict runtime guard: only `MISSION_CONTROL` may change shared bonus or payroll-correction state;
- preview simulation receipts that leave both shared Finance input stores unchanged.

Payment exceptions and QBO evidence remain read-only and are never auto-cleared. This
pack does not issue refunds, write QBO transactions, or mark a Daily Close complete.

The Krewe control pack adds:

- current daily attendance evidence and the complete roster beside tomorrow's JunkWare
  staffing demand and call-in recommendations;
- explicit separation of people who worked or were attributed to a job today from
  roster-only people, without inventing attendance or activity;
- risk-class 1 available or unavailable responses recorded only from a human confirmation;
- risk-class 2 call-in commitments that require approval by a different manager or
  administrator;
- schedule, store, and employee-record observations that reject stale requests before
  a write;
- authoritative read-back of the exact availability or call-in record after execution;
- a strict runtime guard: only `MISSION_CONTROL` may change shared Krewe control state;
- preview simulation receipts that leave the shared Krewe control store unchanged.

A call-in commitment is an OpsCenter staffing record. It does not message the employee,
assign a JunkWare job, or claim that a recommendation is confirmed availability. A
committed call-in also cannot be replaced by a direct availability response; cancellation
and reassignment are intentionally outside this first bounded pack.

The Communications control pack adds:

- one readiness view over Slack delivery state, WhatsApp durable photo and expense queues,
  and the current Podium Reviews snapshot without creating a second message authority;
- a risk-class 2 internal Ops Command notice that requires approval by a different manager
  or administrator and can post only to the owned `#ops-command` channel;
- the shared OpsCenter Slack formatter, a deterministic Slack `client_msg_id`, and a
  `chat.postMessage` channel plus timestamp receipt as delivery verification;
- bounded subject, message, owner, and next-action inputs that reject credentials, email
  addresses, phone numbers, and payment-card data;
- preview simulation receipts that never call Slack or change shared Slack state;
- explicit WhatsApp queue visibility while customer-facing sends remain controlled by the
  verified JunkWare upload, quiet-window batching, and existing delivery workers;
- Podium observation under only the approved `read_reviews` and `read_locations` scopes.

Only the internal Ops Command notice is writable in this pack. It does not accept an
arbitrary Slack channel. WhatsApp retry or manual customer send controls remain locked
because they must first prove the prior JunkWare result and final Meta delivery without
creating a duplicate. Podium review responses and outreach remain read-only because the
approved OAuth token has no write scope.

Together these provide complete governed loops for work state and bounded
Dispatch, Fleet, Finance, Krewe, and internal Communications commands. They do not claim that every external operational system is
controllable yet.

## Authority and safety

Risk-class 0 and 1 human commands can execute when the actor has the required
permission. Risk-class 2 and 3 commands, and agent-initiated writes, require
human approval. Approval-gated actions must be approved by a different manager
or administrator. Cross-date moves, manual resolution, appointment cancellation, and
Fleet availability changes are risk class 3;
manual bonuses and payroll corrections are risk class 3; truck assignment and
same-day rescheduling are risk class 2. Human-confirmed Krewe availability is risk
class 1; a Krewe call-in commitment is risk class 2.
An internal Ops Command Slack notice is risk class 2, is approval-gated, and is
restricted to the owned internal channel. Customer-facing communications remain locked.

Money, payroll, customer communication, access, deletion, and broad operational
changes remain approval-gated. No autonomous production agent or unrestricted
write access exists. External writes must not be added as generic HTTP or SQL
commands; each needs a typed registered adapter, outcome verifier, and recovery
contract.

Source authority stays visible. JunkWare, QBO, LinxUp, and other connected
systems remain authoritative for their own facts; OpsBot must not invent or
silently overwrite source state.

## Remaining system coverage

The next phases should move the remaining direct OpsCenter mutations behind
this registry, then add bounded LinxUp device-review operations, separately approved QBO write workflows, and
customer communication. Each adapter must ship
with its own permission, risk class, approval rule, idempotency strategy,
verification source, audit payload, retry behavior, and recovery guidance.

Only after those deterministic controls are proven should an AI planner be
allowed to turn cited evidence into draft action requests. Autonomous execution
remains locked until its scope, rate limits, rollback behavior, and production
acceptance are separately approved.
