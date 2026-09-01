# OpsBot in Command

Status: Embedded Command assistant over Work, JunkWare Closeout, Systems, Dispatch, Fleet and Truck Load, LinxUp, Finance, Krewe, Communications, Customer Contact, Podium, and SearchKings actions; production kernel activation pending

Route: Command `/?section=overview#opsbot-assistant`; legacy `/?section=opsbot` opens Command Overview

Companions: [OpsCenter OS Constitution](OPSCENTER_OS_CONSTITUTION.md), [Platform Kernel Architecture](PLATFORM_KERNEL_ARCHITECTURE.md)

## Product naming

OpsCenter is the product. OpsCenter OS remains the operating layer and shared
policy-controlled kernel. OpsBot is the AI operator identity. OpsBot is embedded
inside Command and the operating areas where its recommendation or approval is
useful; it is not a separate dashboard destination.

This separation keeps the language useful without implying that an agent owns
the business system:

- OpsCenter contains the authoritative operating experience.
- OpsCenter OS owns work state, action policy, verification, and audit.
- OpsBot observes approved context and may recommend or invoke only registered,
  policy-allowed actions.

The embedded Command assistant uses everyday operating language and appears only
when an exception, approval, or failed result needs attention. It keeps three
questions together: what needs attention, what is waiting for approval, and what
happened recently. Technical terms such as risk classes, registered actions,
source observations, runtime state, and audit ledgers stay in the implementation
and this engineering reference instead of appearing in the operating interface.

## Complete control-system contract

OpsBot actions control OpsCenter through one governed lifecycle:

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
- current Systems, Jobs, Krewe, Fleet, LinxUp, Finance, Communications, Marketing, and freshness observations without a second data authority;
- responsive desktop, tablet, and phone layouts.

The JunkWare closeout pack adds the first source-verified external job correction behind the action registry:

- `jobs.update_closeout.v1` unlocks only for active closeout work covering missing driver, missing navigator, uncredited Krewe, or a missing payment type;
- the operator must load the current JunkWare closeout before preparing the complete crew, charge, time, and optional payment request;
- the durable request is tied to the exact work-item version and a SHA-256 observation of the current closeout values, available options, charges, and payments;
- risk class 3 and `sensitive.write` require approval by a different manager or administrator;
- execution re-reads the closeout under the serialized appointment lock, rejects changed evidence, writes only at `MISSION_CONTROL`, and verifies every requested field from the post-save JunkWare page;
- preview performs the same validation and source-observation checks, while the action makes no closeout, payment, truck-load, Slack, or shared OpsCenter change;
- a verified write records truck-load and closeout-notification side effects when available, but does not directly resolve the work item. Fresh exception detection remains the only source-verified resolution path.

The existing Jobs closeout remains available during migration. The governed path is embedded in Command so the owner, reason, exact source evidence, approval, execution, and audit receipt stay together.

The Systems control pack adds:

- one supervision surface over the platform kernel, operator authentication, JunkWare
  schedule, LinxUp delivery, QBO reconciliation, Slack Ops Command, WhatsApp photo
  queues, Crew Portal sync, Podium Reviews, and SearchKings reporting;
- distinct `healthy`, `degraded`, `attention`, and `unavailable` states derived from
  each owning source instead of treating a green `/api/health` response as universal readiness;
- explicit separation of collector or integration health from downstream business
  exceptions, such as an individual stale LinxUp tracker or a QBO payment mismatch;
- a risk-class 2 recovery review with required disposition, owner, next bounded action,
  evidence note, and approval by a different manager or administrator;
- exact source-observation, review-store, and prior-review version checks so an
  approval cannot be applied after integration evidence changes;
- durable internal recovery records, attribution, audit history, and authoritative
  read-back of the exact owner, disposition, and next action;
- preview simulation receipts that leave shared systems review state unchanged.

A systems recovery review records ownership and intent only. It never restarts a service
or collector, changes credentials, touches a tunnel or database, retries a queue item,
sends a message, or overwrites source evidence. Those operations remain locked until
they have separately authorized, typed adapters with narrow targets and verifiable outcomes.

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

The embedded Truck Load control adds:

- the current starting load, calculated capacity, contents, and last authoritative ledger
  event beside each selected Fleet truck;
- `fleet.set_starting_load.v1` and `fleet.record_yard_reset.v1` as risk-class 1,
  permission-checked records of a human-observed load state;
- exact load-ledger observation checks performed again under the file lock, deterministic
  day-start and action-run event identities, and authoritative event read-back;
- a no-op outcome when the approved starting load is already current, without rewriting
  the ledger merely to refresh a timestamp;
- explicit separation between recording a dump or metal-yard reset and causing or claiming
  an unobserved physical truck movement;
- preview receipts that state causally that the action itself made no shared truck-load change.

The existing Truck Load panel and API remain as compatibility paths while callers move to
the registered actions. The governed controls stay in the Fleet command surface so current
load evidence, the operator action, and its audit receipt remain together.

The LinxUp control pack adds:

- a per-device evidence view over tracker freshness, the last actual GPS point, V3 push
  activity, V2 fallback, coordinate availability, and the verified vehicle map;
- an explicit distinction between collector health and device health: a fresh collector
  file never labels a truck `Live GPS` unless that device supplied an actual current point;
- risk-class 2 review dispositions for monitoring, provider follow-up, mapping follow-up,
  or a human-confirmed no-issue finding, with approval by a different manager or
  administrator;
- the exact current device observation, review-store version, and prior record version as
  conflict checks so an approval cannot silently apply to newer tracker evidence;
- durable review records, attribution, audit history, and authoritative read-back of the
  exact saved disposition;
- current-review counts that drop back to zero when newer tracker evidence replaces the
  observation a review was based on;
- review-note guards that reject credentials, contact details, and payment-card data;
- preview simulation receipts that leave the shared LinxUp review store unchanged;
- a strict boundary: the review action does not rewrite telemetry, change the vehicle map,
  contact LinxUp, or change truck availability.

The review record is OpsCenter follow-up state, not a replacement telemetry source. A
`provider_follow_up` or `mapping_follow_up` disposition records the next operational lane;
it does not claim that the provider was contacted or that a mapping correction was made.

The Finance control pack adds:

- an authorized Daily Close snapshot from Truck Records, JunkWare payments, QBO
  reconciliation evidence, manual bonuses, and payroll corrections;
- reconciliation status, exception count, source freshness, and difference shown inline
  without creating a second accounting authority;
- source-backed payment exceptions selectable with their JunkWare and QBO amounts while
  customer, contact, and card data stay out of the control record;
- risk-class 2 payment-exception reviews with a required disposition, owner, next action,
  evidence note, and approval by a different manager or administrator;
- the exact source observation, review-store version, and prior record version as conflict
  checks so newer reconciliation evidence cannot be reviewed through a stale approval;
- current and prior-review states that make a saved review prior evidence when the
  reconciliation is regenerated or its QBO collection evidence changes;
- durable internal review records with attribution, audit history, and authoritative
  read-back of the exact saved owner, disposition, and next action;
- risk-class 3 manual bonuses and payroll corrections that require a different manager
  or administrator to approve;
- bounded amount and rate inputs, required evidence notes, and employee identity checks;
- store and record observations that reject an approval when a newer Finance change exists;
- authoritative read-back of the exact bonus or payroll correction after execution;
- a strict runtime guard: only `MISSION_CONTROL` may change shared bonus or payroll-correction state;
- review-field guards that reject credentials, contact details, and payment-card data;
- preview simulation receipts that leave payment-review, bonus, and payroll stores unchanged.

Payment reconciliation and QBO evidence remain read-only and are never auto-cleared.
The review is internal follow-up state only: it never clears the source exception, posts
or refunds a QBO transaction, changes JunkWare, or marks a Daily Close complete.

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

Only the internal Ops Command notice performs an outbound write in this pack. It does not
accept an arbitrary Slack channel. WhatsApp retry controls remain locked because they must
first prove the prior JunkWare result and final Meta delivery without creating a duplicate.
Podium review responses and outreach remain read-only because the approved OAuth token has
no write scope.

The Customer Contact control pack adds:

- an authenticated contact workspace over current active JunkWare appointments and their
  current phone observations, without copying the customer name or phone into the action
  input, audit record, or governed contact ledger;
- a risk-class 2 call or SMS plan requiring approval by a different manager or administrator
  against the exact current appointment, contact observation, and contact-store version;
- a human-controlled `tel:` call launcher or prefilled `sms:` composer only after the plan is
  approved; OpsBot never presses send and the approval itself performs no outbound contact;
- a risk-class 1 outcome record available only for a still-current approved plan, with
  channel-specific outcomes and a required human evidence note;
- a serialized JunkWare appointment-note adapter that reloads the appointment and verifies
  the exact retained note before OpsCenter records the outcome;
- optimistic source, record, and store conflict checks that reject stale plans and duplicate
  outcomes, plus preview receipts that leave the contact ledger and JunkWare unchanged;
- explicit separation of the human-confirmed outcome, verified JunkWare note, and carrier
  delivery: an `SMS sent` confirmation is not a carrier delivery receipt.

The Customer Contact pack is a governed handoff to a human operator, not an outbound
messaging service. A carrier-backed send remains locked until OpsCenter has a narrow provider
adapter, idempotency contract, final delivery receipt, and duplicate-prevention evidence.

The Marketing control pack adds:

- the fresh read-only Podium Reviews snapshot beside completed JunkWare appointment and
  recorded Krewe evidence without creating a second review or job authority;
- explicit unassigned-review selection with the reviewer, rating, location, and any
  conservative customer-name candidate visible before action;
- the candidate customer, JK number, completed appointment date, territory, and Krewe
  shown together so confirmation is attributable to the intended job;
- separate `confirm suggestion` and `re-assign` intents; a suggested name match never
  becomes employee review credit automatically;
- a risk-class 2 registered attribution request requiring approval by a different manager
  or administrator;
- exact Podium snapshot, review, assignment-store, prior-assignment, and completed-job
  evidence checks that reject a stale approval;
- durable attribution, optimistic conflict protection, audit events, and authoritative
  read-back of the exact saved JK number and Krewe;
- preview simulation receipts that leave shared Podium attribution state unchanged.

The SearchKings recovery pack adds:

- a priority worklist over verified lost and needs-follow-up calls, ordered with lost and
  uncontacted opportunities first, then explicit quoted value and recency;
- source-backed call facts beside any normalized-phone JunkWare booking match, while phone
  numbers and other customer contact details stay out of the action input and audit record;
- explicit separation of a SearchKings call, a JunkWare booking signal, and realized revenue:
  only a completed JunkWare appointment may supply attributed revenue;
- a risk-class 2 registered recovery disposition with a required owner, next bounded action,
  evidence note, reason for lost or unqualified outcomes, and separate-manager approval;
- exact SearchKings snapshot, call observation, recovery-store, and prior-record conflict
  checks so approval cannot apply after newer call, JunkWare, or recovery evidence arrives;
- authoritative read-back of the saved OpsCenter disposition and preview receipts that leave
  shared recovery state unchanged.

A recovery disposition changes OpsCenter follow-up state only. It never calls or messages a
customer, changes a SearchKings call, creates or edits a JunkWare appointment, or claims that
a booking produced revenue without completed JunkWare evidence. The existing Marketing lost-
lead form now creates this same governed approval request instead of writing directly.

Attribution changes OpsCenter reporting only. It never replies to the reviewer, changes
the Podium review, edits the JunkWare appointment, sends customer communication, or
expands beyond `read_reviews` and `read_locations`. The existing Marketing confirm and
re-assign controls now create the same governed action request instead of writing directly.

Together these provide complete governed loops for work state and bounded Systems review,
Dispatch, Fleet, LinxUp review, Finance, Krewe, internal Communications, human-controlled
Customer Contact, Podium attribution, and SearchKings recovery
commands. They do not
claim that every external operational system is controllable yet.

## Authority and safety

Risk-class 0 and 1 human commands can execute when the actor has the required
permission. Risk-class 2 and 3 commands, and agent-initiated writes, require
human approval. Approval-gated actions must be approved by a different manager
or administrator. Cross-date moves, manual resolution, appointment cancellation, and
Fleet availability changes are risk class 3;
manual bonuses and payroll corrections are risk class 3; truck assignment and
same-day rescheduling are risk class 2. Human-confirmed Krewe availability is risk
class 1; a Krewe call-in commitment is risk class 2.
Human-observed truck starting-load and yard-reset records are risk class 1; they do not
assert that OpsBot moved or emptied the truck.
An internal Ops Command Slack notice is risk class 2, is approval-gated, and is
restricted to the owned internal channel. A human-controlled customer-contact plan is risk
class 2 and approval-gated; recording its human-confirmed outcome is risk class 1 only after
the approved plan remains current and the outcome is retained in JunkWare. OpsBot does not
send the call or text, and carrier delivery remains unverified.
A LinxUp device review is risk class 2 and approval-gated; it records bounded internal
follow-up only and cannot mutate telemetry, mapping, provider state, or Fleet availability.
A payment-exception review is risk class 2 and approval-gated; it records only internal
ownership, disposition, next action, and evidence against the exact source observation.
A Podium review attribution is risk class 2 and approval-gated; it requires explicit
confirm-or-reassign intent and verifies the selected completed JunkWare job and Krewe.
A SearchKings recovery disposition is risk class 2 and approval-gated; it records internal
ownership and evidence against the exact current call and JunkWare observation without
performing customer outreach or changing either source system.
A systems recovery review is risk class 2 and approval-gated; it records internal
ownership against the exact current source observation while service, collector,
credential, tunnel, database, queue, and external-delivery mutations remain locked.

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
this registry, then add carrier-backed customer communication and only those QBO write
workflows backed by a connected runtime plus exact external read-back. Direct customer sends
remain locked until a carrier receipt can be verified. Direct QBO writes remain locked until
that accounting authority and verification path exist. Each adapter must ship
with its own permission, risk class, approval rule, idempotency strategy,
verification source, audit payload, retry behavior, and recovery guidance.

Only after those deterministic controls are proven should an AI planner be
allowed to turn cited evidence into draft action requests. Autonomous execution
remains locked until its scope, rate limits, rollback behavior, and production
acceptance are separately approved.
