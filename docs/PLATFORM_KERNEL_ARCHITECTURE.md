# OpsCenter Platform Kernel Architecture

Status: Proposed architecture  
Companion: [OpsCenter OS Constitution](./OPSCENTER_OS_CONSTITUTION.md)

## Architectural direction

OpsCenter should evolve in place as a modular monolith. The existing Next.js application remains the delivery surface while shared platform modules take responsibility for durable work, actions, policy, events, and audit.

The immediate goal is not a rewrite. Existing reads and writes continue to operate while one workflow at a time moves behind the kernel.

```text
Source systems and collectors
        |
        v
Observations and connector adapters
        |
        v
Canonical entities and projections
        |
        +-------------------+
        |                   |
        v                   v
Work-item reconciler     Query services
        |                   |
        v                   v
Policy -> Action runs <- UI / Slack / schedules / agents
              |
              v
        Durable execution
              |
              v
       Outcome verification
              |
              v
       Events, audit, resolution
```

## Current seams to preserve

The existing code already contains useful early versions of kernel behavior:

- `lib/operational-exceptions.ts` produces stable exception rules and entity references from operational observations.
- `app/api/exceptions/route.ts` exposes those signals to authenticated users.
- `app/api/job-route-assignments/route.ts` persists local intent before calling JunkWare, distinguishes pending verification from verified state, and tolerates external failure.
- `lib/job-route-assignments.ts` uses atomic replacement, concurrency guards, explicit pending state, and retryable records.
- `app/api/job-closeout/route.ts` and the JunkWare adapter provide the authenticated closeout action path. The operator chooses whether the completed appointment remains an Estimate or becomes a Job; a successful write marks it Completed and reads both selected values back from JunkWare before reporting success. It can later move behind the action registry.
- `lib/auth.ts` supplies an authenticated actor identity, but does not yet provide roles or action-level authorization.

The kernel should extract and generalize these patterns, not discard them.

## Proposed module boundaries

```text
lib/platform/
  actors/          # actor identity and role/resource scopes
  actions/         # definitions, validation, policy, runs, execution
  audit/           # sanitized immutable audit records
  entities/        # canonical identifiers and external references
  events/          # event envelope, append, subscriptions, outbox
  persistence/     # transactions, repositories, migrations
  policy/          # allow, deny, and approval-required decisions
  work/            # work-item lifecycle and detector reconciliation
  adapters/        # source-system action and verification adapters
  observability/   # health, metrics, correlation, stalled-work checks
```

Domain-specific code remains under domain modules and registers its detectors and actions with the platform. The platform must not absorb JunkWare-specific selectors, QBO payloads, or fleet business rules.

## Durable store

PostgreSQL is the target production store for OpsCenter-owned operational state. It provides transactions, concurrency, constraints, and a credible growth path for multiple users and workers.

The deployment decision and runtime-isolation rules are recorded in [ADR 0001](./adr/0001-platform-store-postgresql.md).

Before PostgreSQL becomes a production dependency, preview validation must prove:

- unattended startup and health checks;
- encrypted backup and tested restore;
- schema migration and rollback procedure;
- local failure behavior when the database is unavailable;
- no coupling between preview and production data;
- acceptable operation on Mission Control hardware.

Existing JSON data remains a source/projection during migration. It must not be bulk-imported and silently declared authoritative.

## Minimum schema

The first migration should contain only the kernel tables needed by the Operating Inbox.

### `actors`

`id`, `kind`, `external_identity`, `display_name`, `status`, `created_at`, `updated_at`

Kinds: `human`, `service`, `schedule`, `agent`.

### `actor_roles`

`actor_id`, `role`, `resource_scope`, `created_at`

### `work_items`

`id`, `dedupe_key`, `rule`, `category`, `severity`, `entity_type`, `entity_id`, `title`, `description`, `source`, `source_observed_at`, `status`, `owner_actor_id`, `due_at`, `snoozed_until`, `resolution_code`, `resolution_note`, `first_detected_at`, `last_detected_at`, `resolved_at`, `version`

`dedupe_key` is unique. `version` supports optimistic concurrency.

### `action_runs`

`id`, `action_key`, `action_version`, `risk_class`, `actor_id`, `entity_type`, `entity_id`, `work_item_id`, `idempotency_key`, `input_json`, `status`, `policy_decision_json`, `requested_at`, `approved_at`, `started_at`, `finished_at`, `verification_json`, `sanitized_error`, `correlation_id`

`idempotency_key` is unique within an action definition.

### `approvals`

`id`, `action_run_id`, `requested_from_role`, `decision`, `decided_by_actor_id`, `reason`, `requested_at`, `decided_at`

### `events`

`id`, `event_type`, `event_version`, `aggregate_type`, `aggregate_id`, `actor_id`, `occurred_at`, `recorded_at`, `correlation_id`, `causation_id`, `payload_json`

### `outbox`

`id`, `topic`, `payload_json`, `available_at`, `attempt_count`, `locked_at`, `completed_at`, `sanitized_error`

The outbox is written in the same transaction as state changes so workers cannot lose required follow-up work.

## State machines

### Work item

```text
open -> acknowledged -> in_progress -> resolved
  |          |              |
  +-------> snoozed <-------+
  |
  +-------> dismissed

resolved/dismissed -> open  when the detector sees the condition again
```

### Action run

```text
requested -> awaiting_approval -> queued -> running -> verifying -> succeeded
     |              |              |          |            |
     +------------> denied         +--------> failed <-----+
                                                 |
                                                 +-> queued (retry)
```

Terminal status is never inferred solely from an HTTP status. The action definition controls verification.

## Action definition contract

Each registered action must declare:

- stable key and version, such as `jobs.update_closeout.v1`;
- human-readable purpose;
- typed input validation;
- supported entity types;
- risk class;
- required permission and resource scope;
- idempotency strategy;
- executor;
- outcome verifier;
- retry classification;
- redaction rules;
- operator recovery guidance;
- emitted event types.

UI components ask the registry which actions are available. They do not encode permission rules independently.

## Execution model

The request path creates an action run and commits any required outbox record. A durable worker claims the run, executes the adapter, and records the attempt. Verification happens immediately when possible and is otherwise retried separately.

Long-running external work must not depend on a browser request remaining open. The UI receives the action-run identifier and follows its state.

Initial workers may run within the Mission Control deployment as a separate, narrowly scoped process. Worker service installation is a later supervised deployment step; it is not part of source scaffolding.

## API boundary

Proposed initial endpoints:

- `GET /api/platform/inbox`
- `PATCH /api/platform/work-items/:id`
- `GET /api/platform/work-items/:id/events`
- `POST /api/platform/action-runs`
- `GET /api/platform/action-runs/:id`
- `POST /api/platform/action-runs/:id/approve`

All mutation responses include `correlationId`, the new resource version, and the durable state of the request. A `202` response means accepted or verification pending, never silently completed.

## Identity and policy migration

The current authenticated email becomes the initial human actor external identity. Roles and scopes are added in the platform store. Until roles are configured, new kernel mutations must default to deny outside explicitly bootstrapped administrators.

Crew portal identity remains distinct and narrowly scoped. Service and agent actors use dedicated identities rather than impersonating a human.

## Observability and recovery

Kernel health must expose aggregate status without exposing secrets or business payloads:

- database and migration status;
- queued, running, verifying, and failed action counts;
- oldest queued and verifying age;
- open work items by severity;
- outbox backlog and retry counts;
- last successful detector reconciliation by detector.

Every log entry for platform work includes a correlation identifier. Durable events, not logs, remain the audit authority.

## Migration sequence

1. Add contracts, repositories, schema migrations, and health checks without changing current behavior.
2. Reconcile current `OperationalException` output into durable work items.
3. Add the Operating Inbox using durable work state.
4. Register local work actions: acknowledge, assign, snooze, dismiss, and manual resolve.
5. Wrap one existing external write as a registered action. `jobs.update_closeout.v1` is the recommended first candidate because existing exception rules already identify closeout defects.
6. Add outcome-driven automatic resolution for the wrapped action.
7. Migrate remaining writes one at a time, retaining compatibility routes until each caller moves to the registry.
8. Add Slack and agent callers only after action policy and audit are proven through the UI.

## Explicit non-goals for the first kernel release

- microservices or a general-purpose event-streaming platform;
- replacing external accounting, payroll, telematics, or CRM systems;
- autonomous production actions by AI agents;
- moving all historical source data into PostgreSQL;
- changing Mission Control service state or production cutover;
- redesigning every existing OpsCenter page.
