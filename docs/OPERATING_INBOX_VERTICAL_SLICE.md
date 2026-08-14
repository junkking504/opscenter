# Operating Inbox: First Vertical Slice

Status: Build-ready product specification  
Companions: [OpsCenter OS Constitution](./OPSCENTER_OS_CONSTITUTION.md), [Platform Kernel Architecture](./PLATFORM_KERNEL_ARCHITECTURE.md)

## Outcome

An operator can see current exceptions as durable owned work, act on a closeout defect through a registered action, and watch OpsCenter resolve the item only after the corrected JunkWare state is observed.

This slice proves the complete OpsCenter OS loop:

```text
detect -> own -> decide -> authorize -> execute -> verify -> resolve -> audit
```

## Initial scope

The expanded preview MVP also supports operator-created work items, unresolved cross-day carryover,
rule-specific due times and recommended actions, and an **Act now** queue. Production continues to
hide the Inbox while its kernel is disabled rather than presenting an operator-facing configuration
warning.

### Detectors

The first slice ingests the existing Jobs exception rules:

- `completed_job_with_no_driver`
- `completed_job_with_no_navigator`
- `completed_job_assigned_to_virtual_truck`
- `job_with_revenue_but_no_credited_crew`
- `payment_amount_present_but_payment_type_missing`
- `completed_job_with_no_closeout_photos`
- `whatsapp_job_photo_needs_review`
- `employee_clocked_in_but_not_assigned_to_truck`
- `employee_assigned_to_job_but_missing_from_attendance`
- `open_appointment_past_scheduled_window`
- `missing_customer_information`
- `truck_assigned_to_jobs_but_missing_gps_data`
- `active_truck_with_no_linxup_location`
- `gps_timestamp_older_than_20_minutes`
- `missing_or_stale_expense_source_data`

Other existing Crew, Fleet, Finance, and Jobs rules can be displayed after the reconciler is stable, but they do not block this slice.

### Registered actions

Local Class 1 actions:

- `work.acknowledge.v1`
- `work.assign.v1`
- `work.snooze.v1`
- `work.dismiss.v1`
- `work.resolve_manually.v1`

External Class 2 action:

- `jobs.update_closeout.v1`

The first external action wraps the existing JunkWare closeout capability. Its action definition owns validation, authorization, execution, redaction, retry classification, and verification.

## User experience

Add **Inbox** as the first item after Command in the primary navigation.

The inbox defaults to open work for the current operating date and shows:

- severity;
- title and entity label;
- current owner;
- age and due state;
- status;
- source observation time;
- verification or failure state for the latest action;
- available actions based on policy.

Filters:

- Mine / Unassigned / All;
- Open / Snoozed / Resolved;
- severity;
- category;
- operating date.

Selecting a work item opens a detail surface with:

- the current reason and source;
- entity link;
- ownership and timing controls;
- recommended actions;
- action progress;
- a chronological event history.

The existing dashboard Exceptions panel remains available during migration. It should link into the durable Inbox rather than independently manage work.

## Reconciliation behavior

The reconciler runs the existing exception builder and upserts work using this dedupe key:

```text
{operating_date}|{category}|{rule}|{entity_type}|{entity_id}
```

For each detection pass:

1. New condition: create `open` work and emit `work.detected.v1`.
2. Existing active condition: update `last_detected_at` and source observation metadata without erasing operator state.
3. Previously resolved or dismissed condition seen again: reopen it and emit `work.reopened.v1`.
4. Condition no longer present: do not immediately resolve it. Mark it as absent from the current pass.
5. Condition absent for two successful fresh-source passes: resolve it as `source_condition_cleared` and emit `work.resolved.v1`.

The two-pass rule avoids false resolution from incomplete or stale collector output. A pass using stale source data cannot resolve work.

## `jobs.update_closeout.v1`

### Input

- appointment ID;
- only the allowed closeout fields being changed;
- current work-item ID;
- expected work-item version;
- caller-provided idempotency key.

### Execution

1. Validate the appointment and field allowlist.
2. Record the actor and policy decision.
3. Create the durable action run.
4. Execute through the existing JunkWare closeout adapter.
5. Read back the closeout from JunkWare.
6. Compare the allowed requested fields with observed values.
7. Mark `succeeded` only on a match; otherwise enter `verifying` or `failed` with a sanitized reason.

### Resolution

Successful field verification does not directly force the work item closed. It requests a fresh detector reconciliation. The work item resolves when the originating rule is absent from fresh observed state according to the reconciliation policy.

This preserves a single definition of whether an exception is truly fixed.

## Policy for the first release

- Authenticated `operator`, `manager`, and `admin` roles may acknowledge, assign, and snooze.
- Dismissal requires a reason.
- Manual resolution requires a reason and is visibly distinct from source-verified resolution.
- `jobs.update_closeout.v1` is allowed for `operator`, `manager`, and `admin` on Jobs resources.
- Any future money-changing, customer-message, deletion, payroll, or broad batch action is held for explicit approval.
- Service and agent actors cannot invoke the external action in this first release.

## Failure behavior

- A database failure prevents mutation and returns a correlation identifier; it never falls back to unaudited writes.
- A JunkWare timeout leaves the durable action in `verifying` or retryable `failed` state according to the error classification.
- A worker restart resumes queued or verifying runs.
- Duplicate submissions with the same idempotency key return the existing action run.
- Conflicting work-item versions return a conflict and require refresh.
- Raw external responses, credentials, cookies, and browser-session details are never stored in action or audit payloads.

## Acceptance criteria

- An existing supported exception becomes exactly one durable work item across repeated reconciliations.
- An operator can acknowledge, assign, snooze, dismiss, and manually resolve work with attribution.
- Reappearance of a dismissed or resolved condition reopens the same logical item for that operating date.
- The closeout action records actor, input summary, policy decision, attempts, verification, and correlated events.
- Duplicate action submission cannot duplicate the external business effect.
- The UI distinguishes queued, running, verification pending, succeeded, failed, and denied states.
- A supported closeout correction resolves its work only after fresh source observation clears the detector rule.
- Stale or failed source collection cannot falsely resolve work.
- Existing dashboard and direct operational workflows continue working during migration.
- Preview verification remains unchanged and production services are not enabled by this work.

## Implementation backlog

### Milestone 0 — Decisions and contracts

- Add ADR for PostgreSQL deployment, backup, restore, and migration ownership.
- Define platform identifiers, event envelope, actor, work item, action definition, action run, approval, and policy-decision TypeScript contracts.
- Define redaction and correlation helpers.
- Add action and work-item state-transition tests.

Exit: contracts and state machines are testable without a database or external system.

### Milestone 1 — Durable kernel

- Add database configuration with strict runtime separation.
- Add migrations for actors, roles, work items, action runs, approvals, events, and outbox.
- Add transactional repositories and optimistic concurrency.
- Bootstrap the configured OpsCenter identity as an administrator through an explicit setup command.
- Add kernel health reporting.

Exit: preview can migrate, start, back up, restore, and report kernel health without affecting production data.

### Milestone 2 — Durable inbox

- Implement exception reconciliation with fresh-source gating and deduplication.
- Add inbox query and local work-action endpoints.
- Add Inbox navigation, list, detail, filters, action controls, and event history.
- Link the current Exceptions panel to Inbox records.

Exit: supported exceptions behave as durable owned work through repeated refreshes and restarts.

### Milestone 3 — First verified external action

- Register `jobs.update_closeout.v1` around the existing JunkWare adapter.
- Add action worker and verification retry loop.
- Move the Inbox closeout correction flow to action runs.
- Trigger reconciliation after verified observation.
- Preserve the existing compatibility route until all callers migrate.

Exit: a real closeout defect travels from detection to source-verified resolution with a complete audit chain.

### Milestone 4 — Operational hardening

- Add queue-age, stalled-run, failure-rate, and reconciliation health indicators.
- Test interruption, retry, duplicate submission, stale data, and restore scenarios.
- Document operator recovery for every registered action.
- Review action payload redaction and least-privilege service access.

Exit: the workflow is ready for supervised production release through the existing deployment process.

## Deferred until this slice is proven

- Slack mutations;
- autonomous agent execution;
- bulk actions;
- additional external write adapters;
- cross-day case merging;
- advanced SLA escalation;
- mobile-specific UI;
- replacement of all JSON projections.
