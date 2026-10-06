# Convoy workspace

The desktop Convoy uses truck cards and direct record controls. Its tabs are
Trucks, Inspections & Repairs, Service, Driving, and History & Costs. Existing
`fleetView` route values remain unchanged. A truck selected in the filter or
opened in a record stays selected when switching tabs; All trucks clears the
filter. The filter never silently falls back to a different truck.

Trucks combines recorded condition, inspection status, physical load and GPS
activity. Uncertain load is labeled as needing confirmation and has no capacity
bar. Its original estimate and evidence remain available in the load detail.
Ready describes inspection/repair evidence; it does not establish current GPS.
Load notes are expandable and do not repeat above unrelated tabs. Missing repair
or GPS sources remain explicitly visible.

Inspections & Repairs starts with a compact truck grid, sorted with out-of-service
trucks first. Count filters show all trucks, attention needed, out-of-service trucks,
and missing inspections. Opening a truck brings its inspection and active repairs
together, with direct report, checklist and add/update controls. Resolved repairs
are hidden until requested. Back to trucks restores the overview filter.
Truck cards preview the actual inspection section and inspector notes; the selected
truck shows all findings from the same report used for its inspection status, plus
general notes and the original report link. A later clear report cannot hide an
earlier stop/problem report. When no phone report exists, daily checklist attention
items and notes supply the findings. Photo payloads remain outside the desktop read.

Trucks, Inspections & Repairs, and Service share one daily snapshot and pending read.
Switching these tabs preserves the screen and original retrieval timestamp. Date,
Driving and History & Costs retain separate keys. Fresh authenticated polling,
write invalidation, error retention and authorization checks remain unchanged.
A direct Convoy visit starts its read alongside shell rendering and code loading.

Inspections links to original phone reports and photos. Repairs offers direct
updates without requiring an owner or decision workflow. Existing shop/contact
and planned-date values remain available in optional details and are preserved
when other repair fields are saved. Similar active records are flagged for review,
never merged or deleted automatically. Existing repairs offer Delete repair with
an explicit confirmation naming the repair and truck. A verified deletion removes
the record from repair lists, history, readiness and repair-cost totals; original
inspection evidence remains unchanged. The store retains a private deleted copy
with actor/time and source links, preventing checklist replay from recreating it.
Deleted copies cannot be edited or have attachments changed. The delete action
uses the same permissions, record version, write lock and receipt as repair saves.

Service separates Schedule service from Record completed service. Each action
opens the same versioned record form with the appropriate status. Missing history,
odometer and targets are labeled explicitly. Completed service targets are shown
by service type; a past scheduled date is not proof that service occurred.

Driving keeps scores and event deductions in expandable truck rows, including
coverage and attribution limitations. History & Costs keeps monthly observed
production/driving, repair costs from records updated that month, completed service
costs, and all recorded repair/service history distinct. These are recorded costs,
not a reconciliation against accounting. Missing cost or downtime is not zero.

Writes retain the existing desktop action API, permissions, expected versions,
request IDs, saved receipts and read-back controls. This redesign adds no provider,
metered requests, collector, dispatch change or automatic repair action.

Validation: `scripts/test-convoy-presentation.ts`, fleet action and desktop
receipt tests, inspection/score regressions, CSS architecture, both TypeScript
projects, full production build, synthetic browser saves, and authenticated
acceptance of every live tab. The isolated UI fixture is
`desktop-ui/tests/convoy.html`; its mocked writes never touch runtime records.

## Fleet dashboard and recurring service (October 2026)

The desktop Overview now leads with fleet counts, active repair priorities,
latest LinxUp mileage, a searchable/filterable truck table, and a needs-attention
panel. Click a metric to filter its trucks, a truck to open its service detail,
or a next action to open the owning repair/service view. All existing route keys,
phone inspection links, load controls, driving evidence, history, and cost reports
remain available. The shared desktop shell and operating-day controls remain.

Mileage comes from `readLatestLinxupVehicleInventory`, independently of the GPS
map for the selected operating day. A future planning day therefore retains the
latest available odometer with its report and retrieval times. It does not invent
future or historical GPS. Field precedence is true, virtual, estimated. Without
true mileage, virtual/estimated disagreement exceeding both 1,000 miles and 5%
of the estimated value is flagged for verification. Duplicate vehicle mappings,
estimated-only readings, missing times, future timestamps beyond five minutes,
and readings or retrievals older than 24 hours cannot establish mileage-based
service status. Mileage below the completed-service baseline also requires
verification instead of showing an inflated remaining-mileage figure. This maintenance freshness rule does not change GPS freshness,
arrival, parked-state, or dispatch logic. Values are read from existing local
collector files; no additional LinxUp requests or collectors are introduced.

Recurring intervals live outside Git in `data/fleet/service_intervals.json`, one
record per truck and service type. Operators can set miles, months, both, or pause
an interval. No manufacturer intervals are prepopulated. The most recent completed
service of the same type on/before the planning day supplies its baseline. Monthly
targets clamp to the last valid day of the target month. Explicit next targets on
a completed service override the corresponding recurring target. Due means either
known limit is reached; due soon means within 30 days or 1,000 miles. Scheduled
visits never supply a completed-service baseline or hide a reached target. Missing
baselines/intervals and unusable mileage remain explicit; a known overdue date is
still actionable when mileage cannot be checked. A paused rule stops recurring
calculations; a separately recorded one-time target remains visible.

Use Record service for actual completed work, with its actual date and mileage.
Latest mileage is shown for reference but never copied into a past service.
Schedule service creates a separate planned record. Review a scheduled record to
correct its description or record actual completion, date, mileage and cost.
Unknown costs remain blank; a recorded zero stays zero. Future completed dates,
invalid targets, and negative costs/mileage are rejected before a write.

The `fleet.interval` action uses the existing authenticated operations permission,
shared write lock, record version, request ID receipt, and read-back verification.
Successful service/interval saves close the form after read-back to avoid duplicate
submissions. Corrupt maintenance or interval stores fail closed rather than
replacing existing history. Dashboard test fixtures use only synthetic records.

Validation: `scripts/test-convoy-dashboard.ts` covers independent future-date
mileage, source precedence and conflicts, month-end arithmetic, time/mileage due
status, null/zero handling, schedule separation, interval persistence, replay,
stale-version rejection, input validation and corrupt-store protection. Existing
fleet action, inspection and desktop receipt tests remain applicable.
