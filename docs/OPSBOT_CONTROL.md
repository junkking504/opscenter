# OpsBot Control

Status: Controlled-action foundation; production activation pending

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

## Implemented vertical slice

The current slice provides the control spine and a real end-to-end action path
for OpsCenter work items:

- durable action runs, policy decisions, approvals, state transitions, and events;
- actor-aware permission checks and separation of requester from approver;
- idempotent command requests and authoritative read-back verification;
- a Command action console with work-item selection, action status, and audit summaries;
- direct controls to acknowledge, claim, snooze, and reopen work;
- approval-gated manual resolution with a required reason;
- current Jobs, Krewe, Fleet, Finance, and freshness observations without a second data authority;
- responsive desktop, tablet, and phone layouts.

This is a complete control loop for the bounded work-item domain, not yet a
claim that every external operational system is controllable.

## Authority and safety

Risk-class 0 and 1 human commands can execute when the actor has the required
permission. Risk-class 2 and 3 commands, and agent-initiated writes, require
human approval. The manual-resolution action is risk class 3 and must be
approved by a different manager or admin.

Money, payroll, customer communication, access, deletion, and broad operational
changes remain approval-gated. No autonomous production agent or unrestricted
write access exists. External writes must not be added as generic HTTP or SQL
commands; each needs a typed registered adapter, outcome verifier, and recovery
contract.

Source authority stays visible. JunkWare, QBO, LinxUp, and other connected
systems remain authoritative for their own facts; OpsBot must not invent or
silently overwrite source state.

## Remaining system coverage

The next phases should move existing OpsCenter mutations behind this registry,
then add bounded adapters for JunkWare scheduling, LinxUp fleet operations, QBO
finance workflows, and Slack or customer communication. Each adapter must ship
with its own permission, risk class, approval rule, idempotency strategy,
verification source, audit payload, retry behavior, and recovery guidance.

Only after those deterministic controls are proven should an AI planner be
allowed to turn cited evidence into draft action requests. Autonomous execution
remains locked until its scope, rate limits, rollback behavior, and production
acceptance are separately approved.
