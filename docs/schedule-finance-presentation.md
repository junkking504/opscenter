# Schedule and Finance presentation

## Selected appointment at a glance

Selecting an appointment from the truck schedule, map, or register now opens one
summary beside the map and truck board on desktop, and above them on narrow screens. It shows customer/JK, category/status,
customer window, assignment, address/phone, pickup work, and a bounded source-note
excerpt. The remaining notes, photos, payments and editing controls stay in the
same Full details drawer. Closing that drawer preserves selection; Escape clears
selection. Compact appointment block colors and drag behavior are unchanged.

The summary displays only the first eligible result from the existing closest
truck ranking. It does not render the full candidate list or assign a truck.
Current-day, verified-coordinate, valid-estimate and source-identity checks remain
in force. Failed routing settles to Unavailable; future days do not suggest a
truck from today's GPS. No new provider calls or polling intervals are introduced.

Validation: `scripts/test-dispatch-details-browser.mjs` with the synthetic
`desktop-ui/tests/dispatch-details.vite.config.ts` server checks 320–1440px,
summary visibility, single-candidate display, unavailable/future states, drawer
and Escape behavior, and zero appointment writes.

## All Appointments readability and payments

The register separates appointment identity, customer/work, assignment,
payment, and status into five readable columns; smaller screens use labeled
stacked sections. Full notes stay in the appointment drawer, opened directly by
View details. JK selection still focuses the map, and phone/address links keep
their existing destinations. This does not change compact truck-board blocks.

Job paid is the sum of recorded JunkWare payment rows minus the recorded tip,
not the schedule's ambiguous payment/revenue/quote fallback. Tips and received
totals remain separate, split methods show their amounts, and source balances
are labeled due or credit. Billed/invoiced rows are not called paid. Estimates
remain quoted amounts, never payment requirements. Missing or refreshing
closeout details are explicitly unavailable/updating rather than assumed paid;
inconsistent payment/tip values require review. These are JunkWare records,
not bank-settlement or QuickBooks verification. The drawer uses the same labels.
When a Job has a saved charge total but no recorded payment, the register and
drawer show **Saved charges**, the amount, and **No payment recorded in JunkWare**.
Open appointments also say **Appointment not closed**; saved charges use amber,
not paid green. A blank source balance is not converted into a balance due or a
claim of payment. This exposes payment-follow-up context without closing the
appointment, creating an invoice, or changing source charges.

Validation: `node --import tsx scripts/test-schedule-payment.ts` and
`node scripts/test-appointment-register-browser.mjs` (synthetic fixture on port
3156) cover payment states, tip exclusion, detail opening, and 320–1440px layout.

## Appointment Search Across Dates

Desktop launcher search includes all collected JunkWare Schedule dates rather
than the last 30 metrics dates up to the selected day. **All** is the default;
**Upcoming** includes today onward in America/Chicago, and **Past** means before
today. The selected operating day still supplies Krewe and Fleet results.

Dates are discovered from canonical raw/CSV, verified fast/requested, and
market-watcher filenames. Appointment results use `readJobRows`, preserving
Schedule source precedence, cancellations, and distinct appointment identities.
A file name alone does not establish coverage: rows or a verified observation
are required. Search does not request new JunkWare collection or modify bookings.

Results show customer/JK, date, time, category, source status, and truck, with
exact date plus appointment-ID links. Same-JK appointments stay separate.
Coverage identifies the collected date range, warns of unloaded dates, and
does not imply a new live vendor search. A 15-second process cache bounds repeated
index reads; source timestamps and missing-data states remain Schedule's concern.

Ten appointment results load initially; Show More adds 20, up to 100, followed
by an explicit refine-search message. Loading, unavailable, and no-match states
are distinct. Aborted/older responses cannot overwrite a newer query or filter.
`npm run verify:global-search` covers ranking, dates and identities;
`node scripts/test-search-dates-browser.mjs` uses synthetic browser fixtures on
port 3148 via `desktop-ui/tests/duplicates.vite.config.ts`.

Schedule divides desktop space equally between geography and the truck timeline.
Below 900px it stacks the panels to retain readable appointment blocks. Completed
appointment map pins use a check; cancellations use an X, retaining territory
colors. The six summary metrics share the compact KPI height; Clear is an inline
28px action and does not get its own metric row.

Board appointment blocks and map locators share appointment selection: the map
centers the selected verified pin, keeps its label visible, and outlines the
matching block and register row. Details remain beside the map; Open appointment
opens the full action drawer. Calendar and history retain their drawer behavior.
Selecting a muted block clears filters that would otherwise hide its pin.
An appointment without verified coordinates explicitly shows Verify Address.

Truck and appointment markers use their source coordinates at every zoom level.
Screen-space collision avoidance never displaces them or draws offset leader
lines. Overlapping hit targets show a count badge; clicking opens a list of the
nearby trucks and appointments at that zoom so each remains selectable. Selecting
one uses the same schedule/map selection without relocating any other marker.
Amber truck markers retain the existing last-known GPS distinction. Regression:
`node --import tsx scripts/test-desktop-map-navigation.ts`.

Amazon, Home Sweet Home, and DMTransportation are identified from explicit source
business/customer labels by `lib/appointment-partner.ts`. The map uses AMZ/HSH/DMT
badges, with full names in the selected details, register, drawer and hover labels.
A small diamond marks partner schedule blocks while retaining text-free territory
colors and status cues. Item brands and free-form notes do not establish partner
identity. Alphabetic business prefixes are removed only for geocoding requests;
the street, unit and ZIP remain intact, and results must still pass the original
source house/street/ZIP, precision and non-partial-match checks. JunkWare source
addresses and franchise ownership are unchanged. Regression coverage:
`node --import tsx scripts/test-appointment-partner.ts`.

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

## Duplicate Booking Review

Schedule checks the complete selected-day snapshot before route planning, regardless
of map/search/territory filters. Potential duplicates require distinct source
appointment IDs, an exact normalized service address (unit/building retained), a
matching non-placeholder customer name or phone, and overlapping known windows.
Punctuation and common street abbreviations are normalized; fuzzy/geographic
matches are not inferred. Canceled records, two closed records, adjacent windows,
and explicit source-linked estimate/job pairs are excluded. One completed record
and one open record can still require review. Shared JK numbers are never merged.

The compact review presents both JKs, categories, statuses, windows, trucks,
service territories, and original franchises side by side. Open Appointment uses
the exact record identity; Review in JunkWare opens each source record. Keep Both
requires explicit confirmation and stores only an OpsCenter review decision.
Kept pairs remain available via Show Kept Pairs and can be reopened. It does not
cancel, reassign, hide from dispatch, merge, or send anything to JunkWare.

Decisions live in external runtime data under `duplicate-booking-reviews/`, keyed
by date and pair identity, with source-fact fingerprints and actor/time/revision.
Fingerprint changes (customer/contact, address, window, type/status, JK, franchise,
or truck) require a new review. GPS, refresh timestamps, and unrelated notes do
not invalidate a decision. Authenticated same-origin operations-write access,
server-side source revalidation, per-pair exclusive locks, atomic replace and
read-back, and revision comparisons protect saves. Corrupt/unavailable storage
shows an error and disables Keep Both; it never silently assumes approval.
Lock contention fails closed; a crash-left lock requires operator investigation.

Checks: `npm run verify:duplicate-bookings`; synthetic browser coverage in
`scripts/test-duplicate-bookings-browser.mjs` against the isolated Vite fixture
at port 3148. No real pair should be marked Keep Both merely to test the feature.

## Route Planner

Dispatch service territory is resolved by the shared `lib/service-territory.ts`
from the terminal service locality and reviewed ZIP rules, never from a franchise
fallback. Map colors, register/area groups, calendar counts, and route selection
share this resolver. Greenwell Springs/70739 belongs to BR/GWS; Lafayette belongs
to LF. Known New Orleans postal aliases in Jefferson retain JP dispatch grouping.
JunkWare franchise ownership is preserved independently as `sourceTerritory`;
differences are shown beside the service address and in proposal warnings. No
booking ownership, assignment, accounting attribution, or appointment identity
is changed by geographic classification.

Unknown localities, explicit out-of-state addresses, and conflicting reviewed
city/ZIP classifications are Unclassified / Location Needs Review, never silently
put into a franchise route pool. These stops remain visible on the schedule but
are excluded from route proposals. Address classification does not establish a
verified map pin: road estimates still require independently verified locations.
Existing assigned stops in another known area are retained with an explicit
outside-area warning. Address/franchise changes invalidate prior proposals, and
server validation rejects injected out-of-area unassigned stops. Regression tests:
`npm run verify:service-territory`, required by every production build.

Reviewed geographic references: [Greenwell Springs facility](https://www.copart.com/locations/baton-rouge-la-50),
[Jefferson Parish localities](https://www.jeffparish.gov/850/About-Jefferson-Parish),
[Eastbank addresses](https://www.jeffparish.gov/Directory.aspx?did=37),
[Walker](https://www.walker.la.us/For-Residents), and
[Pearl River](https://www.crt.louisiana.gov/tourism/welcome-centers/pearl-river/).

Schedule's Route Planner sits below the simultaneous map and truck board. It
builds one proposed route per selected truck (up to 12). Trucks with open work
are preselected, not declared crew/load-ready. Current assignments remain on
their trucks initially, including appointments outside the selected area.
Unassigned New Orleans, Jefferson Parish, and Northshore appointments share one
planning pool; Baton Rouge and Lafayette are separate pools. Unclassified
locations are excluded from proposals and listed for location review.
Empty trucks are seeded in distinct geographic clusters. Unassigned work stays
near existing route stops, within an equal-share stop-count cap for new work.
Existing assignments above that cap are retained, not silently redistributed.
Windows determine initial sequence; geographic proximity breaks ties. This is a reviewable heuristic, not a claim of
optimal routing. Closed, unverified, and unidentified appointments are excluded.

Every consecutive appointment identity gets its own road leg, including shared
JK numbers and overlapping time windows. Schedule connectors, closest-truck
comparisons and route proposals use OpenStreetMap/OSRM road minutes and miles
through `lib/osm-travel-matrix.ts`, without live traffic. They share the GPS road
provider rate limit and bounded cache described in [LinxUp GPS](linxup-push.md).
Each adjacent pair uses one road request. No straight-line or zero-time fallback
is fabricated when coordinates or provider metrics are missing. Proposals
are capped at 80 appointments. Missing travel propagates unknown downstream
arrival times even when later road legs are available. Arrival estimates assume
the operator-entered first-stop start and service minutes; the first stop does
not include travel from truck GPS, and windows are not treated as service times.

Operators can reorder stops or move them between proposed trucks, then explicitly
recalculate. Editing assumptions or a source/version/location change invalidates
the displayed estimates and assignment review. The authenticated same-origin
planning endpoint is read-only: no source assignments or stop order are saved.
Review Assignment opens the existing individual JunkWare move confirmation,
preserves the booked window, and requires the normal verified result. Historical
proposals cannot apply assignments. No bulk apply or implied route-order write
is provided. A source change requires a rebuilt proposal.

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


## Saved order within a time slot

Truck Schedule's **Stop Order** control edits one truck and exact booked window.
Arrows change the draft sequence; **Suggest nearest after first stop** keeps the
chosen first stop and greedily follows the shortest verified road distances.
Road-table requests allow up to 15 seconds for the existing provider to respond;
individual route requests retain their five-second limit. The final remaining
stop needs no extra comparison; the draft preview still verifies its travel leg.
Draft conflict checks compare appointment membership, truck/window, cancellation,
service address and saved order. Equivalent address punctuation/state formatting
and unrelated note/payment updates do not interrupt a dispatcher's draft.
Every draft shows its own adjacent travel estimates. **Save Order** persists the
sequence in shared runtime `data/schedule-stop-order/<date>/<group-hash>.json`;
no JunkWare assignment, booked time, completion or visit record is written.
Saving cancels queued travel previews and cannot be interrupted by a preview or
source refresh. Its endpoint uses local schedule reads and the same locked
conflict checks without waiting for address verification or road lookups.
The board stack and routing use the same comparator and invalidate route caches
on a saved order change. New appointments append to a saved group; another date,
truck or window never inherits that group's order. Source/version and saved-order
checks reject stale requests under a per-group atomic-write lock. Missing road
results or locations never generate a geographic-distance ETA. The nearest-stop
suggestion is bounded to 12 stops and is not a global route optimization.

## Shared full-field address verification

`lib/desktop-address-verification.ts` processes the entire source field for every
lookup. It tries the full business/street/suite/locality text first, followed by
a unique street candidate and an explicitly unit-free query if needed. Every
provider response is checked against the original field's house, street and ZIP;
business and suite numbers cannot become the house number. Multiple street
addresses or ambiguous provider matches stay unresolved. Source text is retained.
The Gonzales hospital's 1014 W St Clare/Claire Blvd spelling alias is limited to
that house and locality; FMOL publishes both spellings in its general-surgery and
thoracic-surgery location directories. No generic fuzzy street matching is used.

Verified results are atomically cached by the full original field for 24 hours
(failures five minutes) in `data/cache/service-address-verifications/`. Schedule,
Command map, Fleet planning locations and legacy proximity use these same checks.
The separately owned OpsBot collector is connected through the idempotent
`scripts/install-shared-address-verifier.py --apply` migration after deployment;
its stdin-only bridge runs `scripts/resolve-service-address.ts` from the active
release, then writes the existing appointment-geocode cache for visit detection.
It never falls back to an unchecked location when shared verification fails.
Existing verified source geocodes are retained. Census supplies lookups without
Google Maps API calls or billing credentials.

Validation: `scripts/test-schedule-stop-order.ts`,
`scripts/test-stop-order-route.ts`, `scripts/test-stop-order-browser.mjs`,
`scripts/test-desktop-address-verification.ts`, and the existing schedule,
travel-layout, partner, planning-geocode and route-planner checks.
# Prior estimate on a booked job

## Direct dispatch access to full appointment details

The selected-job summary beside the map and truck schedule on desktop (above them on narrow screens) owns the **Full details** action. See [Selected appointment at a glance](#selected-appointment-at-a-glance) for the current interaction and validation contract. Closing the full drawer preserves the selected appointment and dispatch position.

The Schedule payload resolves `sourceEstimateAppointmentId` against the exact
estimate appointment ID in JunkWare's historical raw snapshots, independent of
the selected Schedule day. It never links by customer name, phone, or JK number.
All Appointments shows the original estimate total, load summary, source date,
source link, and photo count beside (not instead of) current payment information.
The job detail shows the linked estimate's gallery even before completion.
Job photos also render before completion; copied estimate images are not repeated.
Missing quote/photo evidence is labeled unavailable rather than inferred from
today's job charges. This is read-only presentation: no charges, payments, or
JunkWare media are copied or modified. Archive parsing is cached per file and
invalidated when the source file changes.

Validation: `node --import tsx scripts/test-schedule-source-estimate.ts` and
`node scripts/test-appointment-register-browser.mjs` (synthetic local fixture).

Alias evidence: [FMOL General Surgery](https://www.fmolhs.org/locations/greater-baton-rouge/our-lady-of-the-lake-physician-group-general-surgery---ascension) and [FMOL Thoracic Surgery](https://www.fmolhs.org/locations/greater-baton-rouge/our-lady-of-the-lake-physician-group-thoracic-surgery---ascension). These are documentation sources, not runtime geocoding providers.

Deployment startup allowance: a cold all-market JunkWare initialization measured 211.5 seconds on September 9. The detector installer permits up to five minutes for startup while still requiring a verified completion timestamp newer than its restart. Normal polling and data-freshness thresholds are unchanged.

## Schedule control hierarchy

- **Primary action:** compact 32px-high scarlet (`#a43b35`, matching Schedule Lab) **Add Appointment** at the upper-right of the Schedule header, with a plus icon, opens the existing reviewed creation drawer. It does not change booking or assignment behavior.
- **View navigation:** underlined workspace tabs; the current day uses a neutral segmented selector. These sit on a row below the title and primary action, separate from the search and view settings.
- **View settings:** the Map switch exposes its checked state and keeps its label stable. Search and Refresh day use quieter styling.
- **Filters and cards:** counts remain neutral until selected, with a blue selection cue shared by the selected appointment and its summary. Unassigned is an ordinary planning state; Verify Address uses amber when records need review, with no warning color at zero.
- **Guidance:** a pale yellow closest-truck panel distinguishes one available suggestion from selection or assignment; address and assignment review use amber with explicit labels.
- **Supporting actions:** Full details uses an outlined button; inline source-note links reveal more context. Keyboard focus remains visible.

This first application is scoped to the live Schedule workspace. Controls wrap at narrow widths rather than compressing their labels. The dispatch browser check covers the booking-drawer entry, map switch, selected filter state, and visible primary action at 320–1440px without submitting a booking.

On desktop (1000px and wider), selecting a job opens its summary in a right-hand pane without moving the map or truck schedule down. The map height follows the available viewport; full job history can scroll within the detail pane. Narrow screens retain the stacked summary. The appointment grid preserves its readable row heights on unusually dense days instead of hiding destinations.


### Selected truck position and overlapping locators

The desktop truck card resolves the selected GPS point through Fleet's existing
OpenStreetMap address endpoint and displays its report time, age and reported
ignition. A recent collector refresh does not make an old position current.
Address lookups are limited to the selected point; unavailable addresses remain
explicit. Public Google Maps links do not call Google APIs.

Overlapping appointment/truck icons receive deterministic screen offsets with
leader lines to their unchanged geographic anchors. Each icon selects its own
record directly. Zooming apart removes offsets; map focus uses true coordinates.
Reviewed service-complex corrections belong in the runtime geocode cache with
source, precision and previous-value provenance; they do not verify a unit rooftop.
