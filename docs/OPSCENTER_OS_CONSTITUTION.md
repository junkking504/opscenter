# OpsCenter OS Constitution

Status: Proposed foundation  
Scope: Product and engineering rules for evolving OpsCenter into the operating control plane for the business

## Mission

OpsCenter turns operational signals into owned, policy-controlled, verified outcomes.

It is not a replacement for macOS or every vendor system. It is the business operating layer that gives people and automations one place to understand current state, decide what should happen, execute approved actions, and prove the result.

The product promise is:

> From signal to verified outcome without leaving OpsCenter.

## What OpsCenter owns

OpsCenter is authoritative for:

- operational intent, including assignments, decisions, priorities, and requested changes;
- work state, including ownership, status, deadlines, acknowledgements, and resolutions;
- policy, including roles, permissions, approval requirements, and automation limits;
- action history, including who or what requested an action and whether it was verified;
- cross-system identity and references needed to coordinate work;
- derived operational state and projections built from source-system observations.

OpsCenter does not silently claim authority over source data owned by systems such as JunkWare, QuickBooks Online, LinxUp, SearchKings, or Slack. Every domain field must have an explicit authority classification:

- `source_authoritative`: the external system is authoritative;
- `opscenter_authoritative`: OpsCenter is authoritative;
- `derived`: computed from one or more observations;
- `provisional`: locally accepted intent awaiting external verification.

## Core operating objects

Every feature should be expressible through a small shared vocabulary:

- **Actor**: a human, service, scheduled automation, or agent.
- **Entity**: a business object such as a job, employee, truck, payment, lead, or customer.
- **Observation**: immutable data received from a source at a specific time.
- **Projection**: current derived state built from observations and OpsCenter-owned state.
- **Work item**: an operational condition requiring ownership or a decision.
- **Action definition**: a registered, permissioned capability with typed input and an outcome verifier.
- **Action run**: one request to execute an action, including approval and verification state.
- **Event**: an immutable statement that something occurred.
- **Policy decision**: the recorded reason an action was allowed, denied, or held for approval.

## Non-negotiable product rules

### 1. Every exception can become owned work

An exception is not merely a warning on a dashboard. It must be possible to acknowledge it, assign it, set a deadline, act on it, and resolve or dismiss it with a recorded reason.

### 2. Every write is a registered action

User interfaces, API routes, Slack workflows, scheduled jobs, and agents must ultimately invoke the same action definition. Business writes must not be hidden inside page-specific handlers.

### 3. Every action is attributable

An action run records the actor, request time, entity, typed input, permission decision, approval if required, execution attempts, verification result, and sanitized error information.

### 4. Success means verified success

An external request returning successfully is not enough. The action definition must state how the intended result is verified. If verification is delayed, OpsCenter reports `verifying` (displayed as “Verification pending”), not success.

### 5. Repetition is safe

Actions that may be retried require an idempotency key or an explicit duplicate-prevention strategy. Network recovery and worker restarts must not duplicate business effects.

### 6. Authority is visible

The UI distinguishes observed source state, OpsCenter-owned state, derived state, and provisional state. Operators should never have to guess which system currently owns a value.

### 7. Automation earns authority

Automation begins in recommendation mode. It advances to approval-assisted and then bounded autonomous execution only after its success, failure, and recovery behavior are measured.

### 8. Agents use the same permissions as everyone else

An agent is an actor, not a superuser. It can only inspect approved context and invoke registered actions allowed by policy. It never receives unrestricted production credentials or raw write access.

### 9. Secrets never become operational data

Secrets remain in approved environment or Keychain storage. Events, audit records, action input snapshots, logs, and error messages must redact secret material.

### 10. Recovery is part of the feature

Every production action definition documents retry behavior, verification behavior, operator recovery steps, and whether compensation is possible. Backup and restore must be tested for OpsCenter-owned state.

### 11. One deployable system until scale proves otherwise

OpsCenter remains a modular monolith with durable workers. Modules may have strict boundaries, but new network services require a demonstrated operational need.

### 12. Runtime separation is preserved

Preview, production, collector, reconciliation, synchronization, and public ingress are separate capabilities. New platform work must not weaken the existing preview isolation or perform an implicit cutover.

## Initial roles

The first policy model should support these roles even if one person initially holds several of them:

- `admin`: manages identities, policies, integrations, and platform recovery;
- `operator`: owns daily operational work and executes routine actions;
- `manager`: approves sensitive actions and changes operating policy;
- `crew`: accesses only assigned employee-facing workflows;
- `service`: performs a narrowly defined integration or scheduled task;
- `agent`: recommends or performs explicitly delegated actions within policy.

Permissions attach to actions and resource scopes, not to pages alone.

## Action risk classes

- **Class 0 — Read**: no business state change.
- **Class 1 — Reversible local**: changes OpsCenter-owned state and is easily reversible.
- **Class 2 — External routine**: updates an external system with known verification and recovery behavior.
- **Class 3 — Sensitive**: affects money, payroll, customer communication, access, deletion, or broad operational scope; explicit approval is normally required.

Risk class, actor role, resource scope, runtime, and current system health all participate in the policy decision.

## Definition of a complete operating workflow

A workflow is complete only when:

1. a signal or human request creates durable work;
2. the work has status, severity, owner, and timing;
3. available actions are determined by policy;
4. execution is durable and safe to retry;
5. the intended outcome is verified against the correct authority;
6. the work item resolves from evidence or a recorded manual decision;
7. the entire chain can be reconstructed without relying on application logs.

## Near-term product boundary

The first release of OpsCenter OS focuses on daily operations across Jobs, Crew, Fleet, and Finance. It does not attempt to replace accounting, payroll processing, telematics, CRM, or communications infrastructure. Those systems remain connected authorities while OpsCenter becomes the common operating and decision layer above them.
