# Schedule and Finance presentation

Schedule divides desktop space equally between geography and the truck timeline.
Below 900px it stacks the panels to retain readable appointment blocks. Completed
appointment map pins use a check; cancellations use an X, retaining territory
colors. The six summary metrics share the compact KPI height; Clear is an inline
28px action and does not get its own metric row.

Truck Schedule always includes the same Truck 1–9 destinations as New Appointment,
plus any additional truck present in the source and an Unassigned row. The shared
truck choices live in `lib/junkware-trucks.ts`; source labels are normalized and
deduplicated. Empty trucks remain drop targets regardless of the selected date,
appointment filters, or GPS availability. Moving all appointments into or out of
Unassigned cannot remove the other destinations. Truck 0 is a virtual/unassigned
alias. The appointment drawer uses the same destination list as the board.

The timeline grows to fit all truck rows and stacked appointments so the outer
panel cannot clip destinations. These planning rows do not establish GPS position,
crew availability, load, or readiness; those remain separate source observations.
Holding a drag near the visible page or panel edge scrolls at bounded speed;
release, cancellation, Escape, and date changes stop scrolling with the drag.
Moves still require the existing confirmation and verified JunkWare receipt.

Route connectors use the existing proposed route order. Overlapping windows use
vertical connectors between lanes; adjacent windows use a horizontal connector
beneath the blocks. Clicking the estimate opens both appointments and the full
minutes/miles. Booked windows are not moved, and traffic time is not described as
verified visit order, service duration, or available buffer.

Finance Trends shows each metric's month value, month-to-month (MTM) change, and
year-over-year (YOY) change in the same column. August 2026 compares with August
2025. In-progress months compare the same elapsed dates with the preceding month
and the same month last year; each comparison independently clamps both periods
to the shorter month's day count. Full months compare full months, including
February in leap years. Exact dates are visible and comparison values are in
metric tooltips.

Each comparison uses complete published monthly values when available, otherwise
requires every daily record and required metric. Missing prior-year history or
fields remain unavailable, never zero. Average job and margin use aggregate
revenue/jobs/profit, not averages of daily ratios. Operating profit remains an
estimate. Margin changes are percentage points; zero comparison denominators are
labeled without infinity. YTD totals are no longer shown in Finance Trends.

## Historical collection

`reconcile-junkware-monthly.py --month 2025-09 --previous-months 8` collects
January–September 2025 dashboard totals. Finance can use verified monthly revenue
and job counts for full-month YOY even before daily history is available. Expenses
and profit require complete daily history; full-month totals never substitute for
a partial-month comparison.

`collect-finance-yoy-history.py --through 2025-09-06` runs a resumable, bounded
backfill of 249 dates, starting September 1–6 and then August back to January.
It waits for the live refresh, collects and verifies all four territories, collects
historical timesheet rates, and processes the daily metrics. Missing payroll rates
leave Finance cost/profit comparisons unavailable. It does not send Slack alerts
or run the broad refresh/backup pipeline. It pauses between dates and stops after
three consecutive failures. A per-year file lock prevents duplicate workers.
Status lives in OpsBot `data/audits/finance_yoy_backfill_2025.json`; detailed logs
remain in OpsBot `logs/finance-yoy-2025/`. Rerunning resumes unfinished dates.

## Any-date schedule and appointment type

Calendar opens the selected date directly in Board with its map, including future
dates. Selecting an uncollected date requests an isolated, read-only JunkWare
collection across all four markets. Verified results are stored separately as
`history/junkware/junkware_schedule_requested_DATE.json`; they never overwrite
enriched reconciliation, payroll, or raw collector records. Source precedence
uses the newest verified snapshot. A global request lock bounds collection; the
UI distinguishes loading, queued, failed, and verified empty dates. Refresh day
can request a new source check without posting operational messages.

The appointment drawer can change Job to Estimate or Estimate to Job. An
explicit checkbox can complete an estimate. The operation requires a live source
version and durable request receipt, preserves other captured closeout fields,
and verifies JunkWare after saving. Unknown results block another submission.
A verified type/status result overlays older schedule data until a newer source
snapshot arrives. Estimates show quoted amounts and do not require job payment.
Command's Open record follows an internal link in the same tab and opens the
appointment drawer on its source date. Explicit source appointment IDs take
precedence, then a uniquely linked crew-progress appointment. Legacy
`#job-jk…` anchors become Schedule searches; shared JK references remain a choice
instead of selecting an arbitrary job or estimate. Appointment deep-link
parameters wait through queued/loading source reads and are consumed after use
so they cannot restore a stale JK search when returning to Schedule.

When JunkWare requires an assignment to complete an estimate and its live editor
has no truck selected, the type-change form requires an explicit completion-truck
selection. It never replaces an existing assignment. Source validation messages
are surfaced directly; an unchanged full source read proves a rejected save,
while a saved change is verified even if the WebForms navigation timed out.

Completing an estimate also requires JunkWare’s unclosed-estimate outcome: Price/Budget, Date/Time, or Other plus an explanation. If there is no discount, its explanation is required too. The type control collects these facts before review; the adapter handles JunkWare’s second modal and verifies the saved outcome. An HTTP response opening that modal is not a completed save. Classification corrections disable the incidental Send Pictures email checkbox.

JunkWare can fill entirely blank actual-time controls with the scheduled window when completing an estimate. Verification accepts only that exact, unchanged source window and returns an explicit timing-confirmation notice; it does not treat those defaults as GPS arrival/departure evidence. Existing actual times, appointment windows, crew, charges, and payments must remain unchanged. Option-list changes are excluded from field-difference diagnostics.

## Alert note summaries

Appointment alerts show pertinent note details: removal items, access constraints, special requests, and customer ETA contact. Repeated ETA calls become one detail; operator timestamps, routine rescheduling logs, resolved call-center case boilerplate, and promotional boilerplate are omitted. Extraction preserves concrete instructions and negation, deduplicates repeated details, and leaves the complete source notes available in the appointment record. This changes presentation only.
