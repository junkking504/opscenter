# Schedule and Finance presentation

Cancellation remains a first-class appointment action: open an appointment and
use the persistent `Cancel Appointment` footer shortcut. It focuses a dedicated,
visible cancellation section outside the assignment disclosure. A reason and
separate review/confirmation are required; existing JunkWare verification and
no-replay protections remain unchanged. Closed/canceled records do not expose
the action.

The dispatch board reserves bottom space for an `All Appointments` jump banner.
It remains reachable on narrow screens and clears board filters before scrolling
and focusing the complete register. Empty truck rows use the same base height
whether load data is present or missing. The current-time line starts beneath
the hour header. Desktop fits the complete grid (rows, appointment lanes and
travel/status gutters together) into the available viewport, without an inner
scrollbar. Empty truck rows use 32px before fitting. The map uses the full same
height allowance, without the former 600px cap. Duplicate date/introduction
copy is omitted on desktop, with Schedule and its tabs sharing one row.
Phones keep natural-height lanes and page scrolling instead of tiny targets.
`scripts/test-schedule-board-visibility.mjs` checks row/block containment and
last-appointment selection in Chromium and WebKit with the map on and off.
Map and register territory selectors have 38px targets, legible counts and
strong color cues. Territory banners use a colored edge and larger name;
controls wrap on narrow screens rather than shrinking into a tiny legend.

## Schedule planning surface

The truck schedule board is the main visual planning surface. The standalone
Duplicate Booking Check and Route Planner panels were removed from Schedule on
September 11, 2026. Stop Order, board assignment moves, map selection, travel
information, and full appointment details remain available. Appointment-creation
duplicate safeguards and existing saved review decisions are unchanged. The
retained duplicate-review and route-planning modules below document their
contracts; they are no longer mounted or requested by the Schedule board.

## Appointment drawer action priority

Saved appointment notes have their own full-width section, with regular-weight
text and one entry per source note. Recognized trailing date/author attribution
appears above the entry. Only entries beginning `Appointment moved from` are
grouped into expandable Schedule-change history. Other notes, including
call-center narratives, stay visible and unabridged; unknown formats remain
intact. Source order is preserved within each group. Add Appointment Note is
separate from the saved notes and remains below closeout.

Appointment Closeout is a single disclosure control at the top of the appointment
drawer body, directly below its header and before record details. It starts
collapsed for each appointment and loads the JunkWare form on the first click;
there is no second open button. Note entry and its JunkWare
save button remain visible; truck/window changes, Call Ahead and cancellation
are retained in a collapsed secondary section instead of Update the Live Plan.
This changes placement only, not source-write safeguards.

An unresolved earlier move is identified as an assignment blocker in closeout,
never as a closeout result. Check Saved Result reads JunkWare's saved date,
truck and booked window without submitting a move or payment. An exact match
clears the receipt and matching local override under existing locks. A differing
source or newer local plan stays unresolved and is shown for operator review.
Resolving a move resets the closeout editor so the operator must reload current
source data before a new review. `scripts/test-move-reconciliation.ts` covers
this boundary; the dispatch browser test checks section order and note access.

## Schedule loading and canceled addresses

The Schedule snapshot returns source records and cached coordinates immediately.
External address verification runs only in the separate routing/preview path, so
an unresolved address cannot delay the board or hide a newly recorded cancellation.
Canceled appointments remain visible in the schedule and history, but are excluded
from address verification requests, the Verify Address filter/count, and route legs.
Missing coordinates on active appointments still require verification for travel.

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

Canceled customer headings exclude the appended contact/reason text from source
cancellation rows, including the wording "requested to cancel". Cancellation
reason has its own label under status, not customer information. OpsCenter status
labels use U.S. "Canceled"; verbatim source reasons and notes retain their wording.

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

Truck and appointment locators use the same zoom scale: small at overview zoom,
larger at street zoom. The visible icon center stays exactly on its source
coordinate, including after selection, zoom, pan, resize and GPS refresh. Never
shift icons, invent a cluster centroid, or draw locator connector lines.
Every appointment and truck keeps its own locator. Do not combine locations into
clusters, counts or chooser buttons, even when their coordinates coincide.
Amber truck markers retain the existing last-known GPS distinction. Regression:
`node --import tsx scripts/test-schedule-map-layout.ts` and
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

## Duplicate Booking Review (retained module, not shown on Schedule)

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

## Route Planner (retained module, not shown on Schedule)

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

## Finance Trends

Trends opens with month / YTD, month and comparison controls. The operating day
sets the initial month; changing the reporting month is local to Trends. YTD
compares January through the chosen month with the same period last year.
Revenue, completed jobs and weighted average job value lead, followed by a
numeric explanation of revenue movement, a full-month comparison chart, operating
estimates, and expandable newest-first history and source coverage.

Every delta must describe the displayed amount. Full-month revenue and jobs use
verified JunkWare monthly authority when available, even when daily history is
incomplete. Partial-month comparisons require every daily record and required
field in the matching elapsed dates, clamped to the shorter month. They never
substitute a full prior month for partial dates. A daily subtotal differing from
the displayed monthly authority cannot produce a headline percentage. Gaps are
unavailable rather than zero, and YTD requires every included month. Average job
value is aggregate revenue divided by jobs, never an average of monthly ratios.

Costs and profit require complete daily coverage. Published operating profit
retains its source value; it is not recomputed from the reconciled monthly
headline. Margin divides that profit by published daily sales. The daily sales,
known recycling income, costs and published profit are visible together. Any
difference between headline revenue and daily sales is explicitly shown for
reconciliation. These estimates are distinct from QBO financial statements.
Margin changes use percentage points and zero baselines never yield infinity.

Regression checks: `node --import tsx scripts/test-finance-performance.ts` and
`node --import tsx scripts/test-finance-trend-comparison.ts`. The local synthetic
browser fixture is `desktop-ui/tests/finance-trends.html`.

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
thoracic-surgery location directories.

For a single Census address match, automatic verification also accepts one
inserted/missing letter or adjacent letter transposition in one alphabetic street
name token of at least six letters (both spellings). House number, complete city,
Louisiana state when supplied, ZIP, road type, directions and all other tokens
must match. Short names, substitutions, multiple changed tokens, multiple results
and invalid coordinates remain unresolved. This bounded correction uses the same
existing lookup, without additional providers or requests. It preserves the
original source address and records the returned `matchedAddress` and correction
reason in the shared verification cache. Normal matches and accepted corrections
need no manual verification. Remaining unresolved locations use the existing
address-review flow; a single geocoder result is not by itself sufficient proof.

Verified results are atomically cached by the full original field for 24 hours
(failures five minutes) in `data/cache/service-address-verifications/`.
Cache schema 2 immediately retries old schema-1 failures under the new policy;
still-current successful schema-1 entries remain usable. Expired successful
entries are rechecked automatically rather than requiring manual confirmation.
Schedule,
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

- **Primary action:** compact 32px-high scarlet (`#a43b35`, matching Schedule Lab) **Add Appointment** immediately beside **Search appointments**, with a plus icon, opens the existing reviewed creation drawer. It does not change booking or assignment behavior.
- **View navigation:** underlined workspace tabs; the current day uses a neutral segmented selector. These sit on a row below the title, above the search and creation controls.
- **View settings:** the Map switch exposes its checked state and keeps its label stable. Search and Refresh day use quieter styling.
- **Filters and cards:** counts remain neutral until selected, with a blue selection cue shared by the selected appointment and its summary. Unassigned is an ordinary planning state; Verify Address uses amber when records need review, with no warning color at zero.
- **Guidance:** a pale yellow closest-truck panel distinguishes one available suggestion from selection or assignment; address and assignment review use amber with explicit labels.
- **Supporting actions:** Full details uses an outlined button; inline source-note links reveal more context. Keyboard focus remains visible.

This first application is scoped to the live Schedule workspace. Controls wrap at narrow widths rather than compressing their labels. The dispatch browser check covers the booking-drawer entry, map switch, selected filter state, and visible primary action at 320–1440px without submitting a booking.

On desktop (1000px and wider), selecting a job opens its summary in a right-hand pane without moving the map or truck schedule down. The map height follows the available viewport; full job history can scroll within the detail pane. Narrow screens retain the stacked summary. The appointment grid preserves its readable row heights on unusually dense days instead of hiding destinations.


### Selected truck position, trips and overlapping locators

The desktop truck card prefers LinxUp's recorded destination address when it is
within 30 metres of the last GPS fix. Otherwise it resolves only the selected
point through Fleet's existing OpenStreetMap endpoint and labels the result Near.
Report time, age and reported ignition stay visible. A collector refresh does not
make an old fix current. No Google APIs are used.

Regional maps keep every geographic anchor unchanged. A single overlapping
truck/appointment pair may separate by at most 44 pixels at zoom 15 or closer,
with a short line to the original point. Larger clusters offer a choice of
records without spreading markers. Appointment and truck icons stay above routes.

Trips come from LinxUp trip records, ordered by departure on the selected Central
date. Zero-mile ignition cycles at the same location are excluded. The list shows
only trip number, origin, destination and departure/arrival time. Selecting a trip
fits its recorded extent and shows matching numbered A/B endpoints. Road geometry
uses the existing street routing; unavailable roads never become straight chords.

A confirmed visit without a departure takes precedence over another truck's ETA.
Fresh GPS shows On site; once the GPS ages out, Last reported on site preserves the
truck and latest inside-report timestamp without claiming a current fix or pulsing.
A recorded departure clears that indication; completed/canceled states take priority.
Reviewed service-complex corrections stay in runtime cache with source, precision
and previous-value provenance; they do not verify an exact unit rooftop.

## Automatic map inputs and current GPS presence

The existing minute LinxUp refresh runs `refresh-schedule-map-inputs.ts` before
visit matching. It copies the current all-market verified Schedule snapshot to
the matcher's supplemental source only when newer and fresh. Pending dispatch
writes are not promoted to JunkWare truth. Every collected upcoming date enters
a bounded address queue automatically: four unique missing addresses per cycle,
six hours between unresolved retries, shared Census verification and durable
cache reuse. No Google API or additional paid provider is enabled.

Source-backed corrections are stored outside Git in
`cache/service-address-reviews/<normalized-address-sha256>.json`; they retain the
entire original field, verified address, coordinates, precision and source URLs.
They take precedence over older geocodes in maps and propagate into the visit
cache. Unknown or conflicting addresses remain unverified, never city centroids.

Schedule also reconciles recent continuous GPS dwell against current verified
pins: two distinct reports spanning at least two minutes inside 125 meters,
no uncovered gap over five minutes, and latest GPS at most ten minutes old.
A matching assigned truck can arrive early. If the latest parked report ages
beyond ten minutes, the same dwell remains last-reported-on-site (up to twelve
hours within the current service day); it never gains a live pulse. A newer
position outside the appointment clears this fallback. Other trucks require an eligible
appointment window. Multiple eligible nearby appointments or trucks remain
ambiguous. This presence read does not change assignments or manufacture ledger
arrival/departure events; the existing visit collector owns those events. Its
minute run uses the same two-report/two-minute dwell threshold and includes
arrivals up to four hours before the booked window; verified tracker, address,
coverage, and ambiguity checks remain in force.

The default map refits after its panel finishes resizing, with 28-pixel padding.
Manual pan/zoom and selected appointment/truck views are preserved.
Route arrows across a time gap attach to the source and destination appointment lanes, with a bend when those lanes differ. An incoming route to a same-time stack points to its actual next stop, rather than the bottom of the truck row. Saved stop order and appointment times remain the source of the route and stack sequence.

## Truck progress between appointments

Today's assigned truck rows show their next open stop in saved order, with the
remaining road travel and estimated arrival time from that truck's recent GPS.
A confirmed recorded departure advances the next-stop view without changing the
appointment status. The row says Between jobs only when a departure is recorded;
otherwise it says Next. Neither label confirms the driver's destination.
On-site observations take priority; ambiguous visits and pending assignments
require review. Unassigned appointments never receive automatic truck assignments.

The existing routing request refreshes every two minutes and when appointment,
assignment, visit, or order inputs change. Each active truck requests only its
own next-stop road route through the existing shared non-Google limiter/cache.
GPS older than three minutes, missing coordinates, unverified addresses, invalid
provider metrics and provider failures produce explicit unavailable states.
The UI also rechecks freshness as snapshots arrive, removes an expired ETA, and
opens the exact next appointment when the status is clicked. The tooltip includes
the GPS observation time and no-live-traffic limitation. These are road estimates,
not driver-confirmed destinations or traffic-aware promises.

Synthetic regression: `scripts/test-truck-progress.ts` and
`scripts/test-truck-progress-browser.mjs` cover changing position/ETA, saved stack
order, departure, on-site arrival, stale GPS, missing/failed sources, and no writes.

The next-stop strip also uses the shared parked heartbeat rule: a valid zero-speed,
ignition-OFF report within 75 minutes displays a neutral **Parked · 30m ago**
status. Its original timestamp remains visible in the tooltip. Parked reports do
not trigger routing requests or show an arrival clock, and the customer remains
labelled **Next** rather than implying travel has begun. A recent moving or
engine-on report restores ETA eligibility. Older moving reports display **Last
position** with their age; overdue parked reports display **Last parked** with
their age. Neither confirms current motion. Missing/invalid telemetry remains
**GPS unavailable**. Parked tolerance never extends current on-site evidence.

## Dispatch area colors

Northshore includes Hammond, Ponchatoula/Bedico and nearby Tangipahoa communities
(Robert, Natalbany, Tickfaw, Independence, Amite, Loranger, Kentwood, Roseland and
Tangipahoa), plus the existing St. Tammany cities and Folsom, Madisonville, Abita
Springs, Lacombe and Bush. These are explicit service-locality matches, not a
franchise or broad ZIP-prefix inference.

River Parishes (`RP`) is a separate gray (`#9ca3af`) dispatch designation for
LaPlace, Luling (including the source spelling “Lulling”), Destrehan, Hahnville,
Boutte, Norco, St. Rose, Montz, Reserve, Garyville, Edgard, Wallace, Vacherie,
Lutcher, Gramercy, Paradis, Des Allemands, Killona and Taft. It appears separately
in the map filter, appointment list, calendar counts and route-area contract.
Westwego, Waggaman and Avondale remain Westbank/orange; Kenner/Metairie remain
Jefferson Parish. JunkWare franchise values and service addresses are unchanged.
Regional references: [Tangipahoa communities](https://www.louisiana.gov/local-louisiana/tangipahoa-parish),
[Northshore communities](https://www.visitthenorthshore.com/plan-your-visit/maps/),
[River Parishes](https://lariverparishes.com/mardi-gras-river-style-2026/).

Individual appointment blocks, map markers and selected-card accents use the
shared `appointmentColorClass` rule: Westbank is amber-orange (`#fbbf24`), East
Metro (New Orleans East/Chalmette) is yellow (`#facc15`). Other areas retain their
territory palette. These cues never overwrite JunkWare franchise ownership or
the parish-level grouping/filter. The selected card also names the service area.

The existing East Metro presentation ZIP set (70043, 70126–70129) now refines the
generic New Orleans postal city in the shared service-area classifier. It is a
dispatch zone, not a precise neighborhood boundary: 70126 also covers Gentilly.
See the [City's food-access report](https://nola.gov/nola/media/Health-Department/Images/Making-Groceries-10-3.pdf).
ZIP matching is terminal-only; street names cannot activate the override, and
out-of-state or conflicting service locations remain unclassified.
