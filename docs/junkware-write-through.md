# JunkWare write-through

OpsCenter edits to fields supported by JunkWare must write to the matching source
record and read it back before claiming source success. Local audit durability,
source verification, source ingestion, and displayed calculations are separate.
A local save must never be labeled as a confirmed JunkWare update.

## Timesheets

Both desktop Krewe editors and `/api/payroll-corrections` stage a private audit
record, then run `scripts/sync-junkware-timesheet.ts`. The worker opens
`/franchise/accounting/timesheets.aspx`, selects the exact work date, scans the
franchise rosters, and requires one unique native employee ID. Duplicate names
with different IDs, incomplete rosters, multiple shifts, and overnight records
require explicit source review rather than replacing an ambiguous daily total.
A verified empty shift list permits inserting the manager's missed shift.

The fields written are **Time In**, **Time Out / Date Out**, and the **shift
Hourly Rate**. The employee-profile wage, tips, and calculated pay are not
substituted for those fields. JunkWare recalculates pay. The source pay and
regular/overtime hours are recorded in the verification evidence; OpsCenter uses the verified native hourly wage and regular/overtime hours while
that result matches the correction and no later edit has changed its weekly
basis. This preserves JunkWare's rounding. Without source confirmation,
OpsCenter's weekly calculation stays labeled as a calculation.

Each browser reuses authentication with a fresh ASP.NET session, so collector
franchise/date selections cannot share the payroll editing session.
Synchronization uses a per-employee process lock and a durable submission marker
written before the save. A fresh page load reopens the native employee and
compares all three edited values. A lost navigation is followed by read-back.
Once submission has started, repeat attempts and **Check saved result** are
read-only until the outcome is established. An unconfirmed source result blocks
another correction for that shift and appears under Needs Attention. There is
no automatic bulk backfill of historical corrections.

The source journal lives at
`OPSBOT_DATA_DIR/payroll_corrections/junkware-sync/`. Keep it outside Git along
with the original correction ledger. A source-side edit cannot be undone by
merely deleting its local audit: enter the desired corrected times and save them
through the same verified path.

## Current edit paths

| OpsCenter edit | Source behavior |
| --- | --- |
| Appointment creation | Existing JunkWare creation and verification adapter |
| Truck assignment / appointment window / reschedule | Existing JunkWare assignment/reschedule adapter |
| Appointment cancellation | Existing JunkWare cancellation adapter |
| Appointment notes | Existing append-to-Other-Notes adapter with read-back |
| Job / estimate classification and closeout | Existing JunkWare closeout adapter with source-version guard |
| Load size, additional charges, payment details in closeout | Fields in the existing JunkWare closeout adapter |
| Job photos | Existing JunkWare upload integration |
| Times and shift hourly rate | Verified timesheet write-through described above |
| Fuel/dump receipt ingestion | Existing JunkWare Truck Records uploader |
| Manual bonus | No bonus field in the inspected timesheet editor; explicitly an OpsCenter record |
| Call-ahead tracking | Local operational status; source appointment inspection exposes ETA messaging, not the same boolean. Recording a call must not send an ETA message automatically. |
| Review ownership, Control follow-up, checklists, load observations, lead follow-up, resale inventory | OpsCenter workflow state; do not represent it as a JunkWare record |

Truck Records also offers Recycling and Other categories. A category alone does
not establish identity or authorize posting an arbitrary workflow record as an
expense: completed maintenance costs and recycling proceeds still need a
verified record/field mapping before being treated as synchronized. No blanket
claim that every OpsCenter workflow has JunkWare parity is valid.

Validation: `verify:junkware-payroll`, `verify:corrected-crew-pay`,
`verify:junkware-payroll:browser`, `verify:crew-progress`, `verify:ops-auth`, and
production build. Browser fixtures use synthetic data and make no source writes.
Live source confirmation is separate from these automated checks.
