# Appointment minimum charge

Control appointment details include a manager-only planning calculator. Each appointment card places the cost dollar amount first, left-aligned directly
beneath its quoted or paid amount, with Break-even beside the cost;
without a quoted or paid amount it shows To attend. Break-even uses all modeled
costs and entered revenue fees; To attend uses only fuel, travel labor and
overhead. Clicking either opens appointment info. The breakdown and editable assumptions
are available in Cost details, a compact section below the record facts that
starts collapsed. Cost details are loaded only when first expanded. When only disposal is missing, the card shows the break-even subtotal as a dollar
amount only, as requested by the owner. Disposal remains excluded while missing;
its status is available in Cost details and the amount tooltip. This subtotal includes on-site labor, other entered
costs and revenue fees; disposal and any fees on it remain to be added. The full
break-even and minimum charge remain incomplete until disposal is entered. Unrecorded assignments and labor use clearly labeled provisional assumptions as described below; missing road locations or a current fuel price remain unavailable. Manager access remains
required.
Board totals share one source snapshot and at most two concurrent calculations.
They refresh with the schedule snapshot and after saving cost assumptions. It never changes a quote, payment,
truck, appointment time, payroll, or accounting entry.

Fuel is allocated road miles / MPG × price per gallon. MPG starts at 10. Labor
is total crew hourly cost × (allocated travel + on-site work minutes) / 60.
Overhead starts at $109 per appointment, explicitly provisional: the owner recalled
this figure on October 13 but its original inclusions could not be recovered.
Attendance cost includes overhead, travel labor and fuel; full break-even requires
on-site minutes and disposal, including an explicit zero when applicable.
Confirmed on-site time for the assigned truck fills labor automatically; a saved
manual override takes precedence. Shared travel legs use recorded departure-to-
arrival time when continuous GPS coverage spans both confirmed same-truck visits
and no known facility stop intervenes. Otherwise the road estimate remains labeled.
Other costs and revenue-based fees support payroll burden, royalties, bonuses and
card costs. Break-even = fixed dollar costs / (1 - revenue fee fraction).
The minimum whole-dollar charge is strictly above break-even; target margin uses
costs / (1 - fees - margin). These are modeled figures, not realized profit.

Cost planning uses the same truck as the appointment card: its booked truck, or the uniquely GPS-confirmed truck when unassigned, or the recorded truck for a completed appointment. This projection never changes the source assignment. All appointments are projected before selecting route neighbors, so fuel, route allocation and crew use one consistent truck. On-site labor only uses a completed visit matching that truck. Named appointment crew retains precedence; when absent, the dated roster or current crew for the displayed truck supplies labor. The truck's existing Schedule route order supplies adjacent jobs.
Each shared job-to-job leg is split evenly, and first/last warehouse legs count
in full. The default warehouse is inferred from the first stop's territory and
is labeled and editable. No live GPS position or booked window is treated as
actual travel/labor. Missing routes never become zero. Canceled jobs have no planned route estimate or attendance row. Unassigned jobs use the closest-truck provisional round trip when live GPS routing is available. Dump detours are excluded and must be budgeted in costs.

Crew rates come from the appointment's named driver, navigator and additional
crew, then the dated planned roster or an unambiguous current truck crew snapshot,
using the latest available rate within 14 days at or before the operating
date (no later than today). Dates are shown. Base hourly rates omit burden and
overtime; a combined loaded hourly override is available. Missing names/rates use the provisional crew assumption below.

## Provisional card estimates

When the truck route is unassigned or verification is pending on the live day,
select the closest truck by geographic distance from its reported GPS position. Use a standalone
road round trip from that truck's last reported GPS location to the appointment
and back to the same location, plus its crew and fuel evidence when available.
The basis names the truck, GPS observation time and assumed return. Explicit
out-of-service trucks and invalid positions are excluded. Selection is local and requires no fleet-wide road table; only the selected
truck's two road legs are requested through the existing shared provider cache
and rate limit. This avoids a fleet lookup timeout replacing a nearby truck
with the warehouse fallback. A parked truck's last
reported location remains eligible under the map's existing proximity policy.
This is a planning candidate, not a promise of availability or dispatch assignment.
The cost refresh key includes truck positions, GPS timestamps and crew data.

If closest-truck evidence is unavailable (including a non-live day), the labeled
fallback remains a local warehouse round trip (BRHQ for Baton Rouge, otherwise
NOHQ). No unrelated unassigned jobs are joined into a fictional route. Existing source
assignments and booking times are unchanged. When named crew rates are unavailable,
use a provisional two-person crew at $40/hour combined ($20 each). Missing on-site
work uses 30 minutes for break-even only; attendance excludes on-site work. Saved
overrides and recorded sources replace these defaults automatically. When a current
truck-specific WEX price is absent, the newest matched fleet alert within seven days
is an explicit planning price. No current alert still means unavailable fuel.

Cards append “estimated” when their amount depends on these provisional inputs.
Cost details and tooltips list the assumptions, with existing per-appointment
crew, on-site time, warehouse and fuel overrides. These are planning figures, not
recorded assignments or labor. Canceled appointments do not display an upcoming
attendance estimate and cancellation never produces a GPS truck-mismatch warning.

## WEX Outlook alerts

The source is OnlineServices@wexinc.com purchase alerts in
eugene.dabezies@junk-king.com, not the legacy posted CSV. A read-only Outlook
connector retrieves messages. `scripts/import-wex-realtime-prices.ts` imports a
private JSON array of {id,sender,receivedAt,body,sourceUrl}. It requires a positive
Fuel purchase, GA units, tracking identity and a valid authorization timestamp.
Amount divided by gallons is the observed price. The driver identity resolved by WEX from the employee code is matched to that
operating day's JunkWare crew assignments. A unique truck is usable. When an employee has multiple dated truck assignments,
a unique LinxUp match must identify one of those trucks. LinxUp can also identify
an otherwise unknown truck; conflicting employee/GPS evidence stays unresolved. Shared card
numbers never mean truck IDs.
The alert's generic Fuel product does not establish diesel versus gasoline.
The newest truck-matched price is eligible for seven days, with timestamp and
source link shown. Unknown/stale inputs require a manual price assumption.

The derived snapshot is `integrations/wex-fuel/realtime-prices.json` outside Git.
It is separate from posted expenses; importing never creates an expense or sends
a message. The initial connector import is a point-in-time read. No autonomous
Outlook polling is installed by this change; future connector imports update the
snapshot. The UI must not represent a retained alert as a continuously live feed.

Cost settings use immutable versioned revisions under `appointment-costs` outside
Git, scoped by date and appointment ID. The registered local action
`schedule.appointment-cost.save` requires sensitive.write, rejects stale versions,
and verifies saved read-back. GET requires finance.read. Source failures remain
visible; canceled/missing records do not trigger source writes. Validation uses
synthetic costs, routing and WEX fixtures, never live purchase writes.

## Refresh continuity and recorded inbound origins

Cost reads coalesce source changes into a single follow-up instead of aborting
in-flight work. Cards retain the last completed amount during refresh with an
“updating” label, or “last estimate” if refresh fails. Changing the selected day
clears the old day's values; access denial clears retained values. Missing route
locations say “Location unavailable” immediately, rather than appearing to
calculate indefinitely. Other terminal failures distinguish route and fuel gaps.

For an assigned route's first appointment, a uniquely matching recorded GPS trip
into that appointment replaces the assumed warehouse origin. It must match the
truck, first recorded visit arrival within five minutes and destination within
200 metres, and start at least 400 metres away. Mileage remains road-estimated;
travel labor uses the recorded trip duration. This does not reuse the truck's
current location for a past visit. Existing shared job legs retain their allocation.
When no next job is assigned, the return remains a labeled warehouse assumption,
not evidence of a return actually driven. Unassigned closest-truck planning is
unchanged. No source assignment, address or payment is modified.
