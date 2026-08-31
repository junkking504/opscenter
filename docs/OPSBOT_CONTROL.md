# OpsBot Control

Status: Initial read-only control surface

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

## Initial release

The first release is a server-rendered, read-only Command subview. It uses the
same current Jobs, Krewe, Fleet, Finance, and data-freshness projections already
used by Command. It does not introduce a second data authority.

The surface contains:

- current signal lanes and their named source systems;
- a decision queue built from the current Command exception rules;
- the explicit autonomy ladder: Observe, Recommend, Execute, Autonomous;
- the signal-to-verified-outcome lifecycle;
- the real platform-kernel connection state;
- responsive desktop, tablet, and phone layouts.

The Operating Inbox is not a prerequisite. When the action kernel is disabled,
OpsBot Control remains useful in read-only mode and labels the kernel as staged.

## Authority and safety

The first release has no action controls, no agent credentials, and no
autonomous execution. `0` pending approvals and `0` autonomous actions describe
the implemented action surface, not an inferred external queue.

Money, payroll, customer communication, access, deletion, and broad operational
changes remain approval-gated. Future execution must use registered action
definitions with actor identity, typed input, permission policy, idempotency,
outcome verification, recovery guidance, and sanitized audit events.

Source authority stays visible. JunkWare, QBO, LinxUp, and other connected
systems remain authoritative for their own facts; OpsBot must not invent or
silently overwrite source state.

## Next vertical slice

The next slice should add one recommendation detail with cited evidence and a
draft action request. The recommended first action remains a bounded existing
workflow, not a sensitive write. It should stop at approval until durable action
runs and verification have been proven in preview.
