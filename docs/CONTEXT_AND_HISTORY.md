# Context and History

## Durable context layers

OpsCenter uses three layers of durable knowledge:

1. Repository documentation in `docs/` is the canonical reviewed product and
   technical record.
2. `/Users/missioncontrol/Documents/Codex/OPSCENTER_MEMORY.md` provides concise
   cross-task continuity for local agents.
3. Codex task history and memory summaries provide provenance when an exact
   historical decision, command, or incident needs to be reconstructed.

Durable conclusions should move upward into repository documentation. Raw task
history should not be copied wholesale into Git or a Business project because
it can contain stale state, operational identifiers, or incidental sensitive
context.

## Verification rule

Historical records identify where to look; they do not prove current state.
Before reporting production status, verify the current repository ancestry,
active release marker, service health, source-system freshness, and the exact
authenticated behavior relevant to the question.

## Important retained decisions

- OpsCenter is an operating control plane, not only a dashboard.
- JunkWare remains the scheduling/appointment source; OpsCenter is an
  authenticated operational surface.
- Appointment notes created in OpsCenter are append-only JunkWare **Other
  Notes** entries. The write path serializes with other appointment changes,
  reloads the appointment, and confirms the new note before it reports success.
- Financial, payroll, lead, GPS, and appointment values must remain
  evidence-backed and preserve provenance.
- Map/appointment selection displays detail; live camera access requires the
  explicit `View live video` action.
- Krewe Portal pay information is employee-private.
- Production delivery uses immutable releases and changes only the documented
  OpsCenter service unless another service is explicitly in scope.
