# Schedule and Finance presentation

Schedule divides desktop space equally between geography and the truck timeline.
Below 900px it stacks the panels to retain readable appointment blocks. Completed
appointment map pins use a check; cancellations use an X, retaining territory
colors. The six summary metrics share the compact KPI height; Clear is an inline
28px action and does not get its own metric row.

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
Appointment deep-link parameters are consumed after use so they cannot restore
a stale JK search when returning to Schedule.
