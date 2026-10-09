# Convoy workspace

The desktop Convoy uses truck cards and direct record controls. Its tabs are
Overview, Repairs & inspections, Maintenance, Records & invoices, and Driving. Existing
`fleetView` route values remain unchanged. A truck selected in the filter or
chosen explicitly stays selected when switching tabs; All trucks clears the
filter. The filter never silently falls back to a different truck.

Trucks combines recorded condition, inspection status, physical load and GPS
activity. Uncertain load is labeled as needing confirmation and has no capacity
bar. Its original estimate and evidence remain available in the load detail.
Ready describes inspection/repair evidence; it does not establish current GPS.
Load notes are expandable and do not repeat above unrelated tabs. Missing repair
or GPS sources remain explicitly visible.

Repairs & inspections uses the same persistent truck navigation and expandable
journal as Records & invoices. Sidebar counts show active repairs; condition
filters show matching trucks. Out-of-service trucks sort first. Search covers
truck, finding, repair, shop and resolution text. Selecting a truck expands its
inspection without losing the fleet navigation. Inspection & photos opens the
original report separately; checklist and repair actions retain their existing
editors. Repair rows expose owner, planned date, status, cost and resolution.
Resolved repairs remain collapsed until requested. On phones, trucks scroll
horizontally and a condition selector replaces the sidebar condition filters.
Truck rows preview the actual inspection notes; the expanded
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
latest reported mileage, a searchable/filterable truck table, and a needs-attention
panel. Click a metric to filter its trucks, a truck to open its service detail,
or a next action to open the owning repair/service view. All existing route keys,
phone inspection links, load controls, driving evidence, history, and cost reports
remain available. The shared desktop shell and operating-day controls remain.

Mileage uses the latest saved phone inspection when it reconciles with the
previous inspection and completed service mileage. Report metadata is read from
`fleet/truck-inspections/reports` and cached without embedded photos. Regressions,
nonpositive/invalid readings, future timestamps and jumps exceeding the greater
of 500 miles or 1,500 miles per elapsed day need verification. A lone inspection
needs corroborating service mileage. Invalid latest reports stay flagged rather
than silently selecting a more convenient older reading. Older inconsistent
reports do not invalidate a subsequent consistent pair.

The original inspection date, receipt time and report link stay visible. This is
an observed reading, not an estimate of today's odometer. Existing raw reports
and LinxUp counters are never rewritten. With no inspection, the existing
`readLatestLinxupVehicleInventory` fallback uses true, virtual, then estimated
mileage, independently of the selected day's GPS map. Without true mileage,
virtual/estimated disagreement exceeding both 1,000 miles and 5% is flagged.
Duplicate mappings, estimated-only readings, missing timestamps and observations
or retrievals over 24 hours old cannot establish remaining mileage. An older
consistent inspection can establish an already-passed target, with its date
shown, if it is on/after the completed service and on/before the planning date.
It cannot establish positive miles remaining today. Readings below completed
service mileage stay flagged. No new provider requests or polling are added;
GPS freshness, arrival, parked-state and dispatch behavior are unchanged.

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


## Teaching Convoy: October 7 usability update

The permanent **How to use Convoy** guide explains five tasks: check fleet,
handle repairs, plan maintenance, find past work, and review driving. Each view
has a short purpose statement. Viewing day governs inspections/driving/planning;
it does not filter the history list. Existing route keys are unchanged.

**Records & invoices** opens all recorded dates across the selected trucks,
with a truck and work-category navigation rail, matching record counts, and a
month-grouped service journal. Select a visit to expand its work summary, then use
Open record or Invoice photos. On phones the truck choices scroll horizontally
and work categories remain available under Filters. Text search covers work,
vendor, VIN/source notes and invoice number. Filters contains record type, service
category, and inclusive From/Through dates. Empty results offer a reset.
CSV exports contain the currently filtered records, with unknown costs blank;
spreadsheet formula prefixes are escaped. Monthly usage/cost summaries and fuel
charts remain in labeled expandable sections below the record list.

Invoice summaries and their explicitly linked categories display as one visit.
Only `Linked invoice record: <recordId>` links to a matching invoice summary on
the same truck, status and service date collapse categories. Orphans and mismatched
records stay visible. Invoice totals count once, even when categories have no
allocated cost. Known completed costs and the number of missing totals are shown
separately; zero remains a recorded value. No records are merged or rewritten.
Opening a record does not silently change the truck filter. Service details show
work, dates, mileage, shop, linked categories and authenticated invoice photos.
Work details and Invoice photos are separate sections; the photo action opens
the photo section directly. Original pages open at full size in a new tab.
Editing is explicit; all existing action/version/receipt rules still apply.
Repair history opens a readable detail; the active repair board retains direct
Update repair. Report a problem has an explicit truck selector. Service work and
notes use multiline fields. The dialog keyboard trap includes visible disclosures
and returns focus to the original opener after closing.

Maintenance uses the same truck navigation, search and expandable rows. Service
plan lists tracked intervals and explicit targets, with last service, next date
and mileage target, original reading evidence and editing actions inside each
row. Sidebar counts and filters refer to service targets, not trucks. The default
list uses tracked categories, or Oil & filter as a setup entry when none exist;
other categories remain optional. Selecting a truck also exposes Add interval.
Scheduled visits is a separate view with a past-date review filter and the
existing Schedule service / Review service record workflows. Completed work
opens Records & invoices while retaining truck selection. Missing readings stay
unknown; older inspection evidence retains its date. No interval values, source
precedence, due calculations or saved maintenance records change in this layout.

Overview mileage also compares the latest reading to completed service mileage.
A lower reading displays Needs verification with the recorded service mileage.
Original source values remain in the mileage detail. This does not change LinxUp
or substitute an estimated odometer. Existing service calculations already reject
readings below their completed-service baseline. Records/photos remain in the
existing private stores; no collectors, paid services, or polling were added.

Validation includes `scripts/test-convoy-records.ts` (grouping, orphan/mismatched
links, filters, partial costs, null/zero, and mileage evidence), existing Convoy
and action tests, both type checks, desktop build, and synthetic UI acceptance.

## Compact truck readings (October 8, 2026)

Overview leads with compact per-truck service, fuel and onboard-load readings. Service progress
uses the completed-service baseline and the existing service plan's usable mileage
and calendar targets; the earliest reached limit governs. Due/soon/unknown status
remains textual as well as colored. Missing baselines and unusable mileage never
render as zero usage. The service planner and truck detail expose individual
interval readings with thin horizontal bars. Existing filters, mileage evidence and record actions remain.

Readings use text values, short source/timestamp notes and a thin bar only when
the value is known. Missing values have no empty dial or placeholder bar. Inspection
and latest readings sit side by side on wide screens and stack on smaller screens.

Fuel starts with the selected day's timestamped inspection. Per the owner's
October 8 instruction, a later recorded fuel purchase means an **assumed full tank**.
The latest inspection or purchase wins; equal-time inspection evidence takes
precedence. This is labeled with its source and Central-time timestamp, not live
sensor telemetry. No consumption, range or tank capacity is fabricated, and fuel
levels do not carry into another day. GPS proximity to a station is insufficient.
Verified operational fuel expenses and already-attributed posted WEX purchases
supply fill-ups. Ambiguous/unreconciled expense allocations and unassigned WEX
transactions do not update a truck. Delayed records take effect after receipt,
ordered by their original transaction time, never import time. Duplicate purchase
sources set Full idempotently rather than adding fuel twice.

Load reuses the existing operational projection: inspection/observed baseline,
completed pickups and verified unloads. Uncertain load has no capacity bar and displays
Confirm load, and over-capacity estimates keep their actual percentage in text.
Daily inspection detail separates original fuel/load readings from the latest
truck readings. The existing 30-second workspace refresh updates these projections;
no new polling, paid request, collector or business write is added.

Validation: `scripts/test-convoy-gauges.ts`, existing inspection/load sequencing
and service-plan regressions, both TypeScript checks, desktop and production builds,
synthetic dashboard/inspection/load-save tests, and authenticated live acceptance.

A GPS-advanced estimate retains its reconciled visual inspection baseline. If that
baseline alone had already crossed the target after the last service, the service
plan preserves Due now and its original reading timestamp/overdue amount. The GPS
estimate cannot clear a proved overdue state or establish positive remaining miles.

## Overview vehicle identity (October 9, 2026)

Each top-level truck entry shows the full selectable VIN and latest mileage next
to its operational status. VINs come from the existing saved LinxUp vehicle
inventory, are normalized to uppercase, and remain unavailable when absent.
Duplicate truck mappings or malformed VINs show Needs verification rather than
choosing a vehicle identity. The truck list also shows VIN and supports VIN search.
Mileage retains the existing inspection reconciliation, GPS estimate labels,
conflict checks and source timestamp; these additions do not change its value or
maintenance decisions. No new provider requests or runtime record writes occur.
