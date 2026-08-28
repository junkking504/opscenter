# Today’s Fleet Work

The Fleet Maintenance overview is the operational queue for truck work. It
turns existing repair, inspection, and telemetry evidence into explicit next
actions; it does not alter source records merely because a signal is observed.

The landing page shows one next step per truck. `Stop` and `Urgent` evidence
is presented as **Act now**; `Next` evidence is presented as **Plan next**.
`Watch` evidence stays out of the daily queue until it needs human review.
The three summary counts are out-of-service trucks, active repairs, and
incomplete inspections. The editable Repair Queue remains the detailed system
of record in its own adjacent view, so its table and attachments do not compete
with the daily queue. Opening a repair from Today’s work switches directly to
that editable work order.

## Current action rules

| Evidence | Priority | Action |
| --- | --- | --- |
| Open `out_of_service` repair | Stop | Open the repair work order and make a return-to-service decision. |
| Repair past its due date | Urgent | Update the work order with ownership, a plan, and evidence. |
| Open repair without an owner or due date | Next | Assign the work and schedule it. |
| Incomplete daily checklist | Next | Open the selected truck's daily checklist. |
| LinxUp tracker offline | Urgent | Review the live Fleet map and verify the truck/device. |
| LinxUp data stale or tracker mapping unresolved | Watch | Review the live Fleet map; do not infer a current location. |

## Evidence boundaries

- LinxUp freshness is a device-data claim. It does not prove a truck is safe,
  repaired, dispatched, or physically present at a job.
- A repair status, owner, due date, resolution, cost, downtime, invoice, and
  completion photos belong to the repair work order.
- A completed checklist is an inspection record. Items marked `Needs attention`
  may create repair work orders, but the checklist itself is not repair proof.
- The Action Center creates no automatic work orders and makes no automatic
  dispatch or out-of-service change. Operators retain the decision and its
  audit trail.

## Future inputs

Future data sources should normalize into the same evidence-and-action model:
vehicle/OBD diagnostics, vendor invoices, fuel purchases, registration and
insurance expirations, recurring repair history, and manual mechanic updates.
Each input must preserve source, observed time, confidence, and a link to the
resulting work order or review action.
