# Appointment minimum charge

Control appointment details include a manager-only planning calculator. Each appointment card shows To attend directly beneath the quoted or paid
amount; clicking it opens the breakdown. This uses the same attendance subtotal
as the drawer, with calculating/unavailable states and manager access retained.
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

The assigned truck's existing Schedule route order supplies adjacent jobs.
Each shared job-to-job leg is split evenly, and first/last warehouse legs count
in full. The default warehouse is inferred from the first stop's territory and
is labeled and editable. No live GPS position or booked window is treated as
actual travel/labor. Missing routes never become zero. Canceled/unassigned jobs
have no route estimate. Dump detours are excluded and must be budgeted in costs.

Crew rates come from the appointment's named driver, navigator and additional
crew, then the dated planned roster or an unambiguous current truck crew snapshot,
using the latest available rate within 14 days at or before the operating
date (no later than today). Dates are shown. Base hourly rates omit burden and
overtime; a combined loaded hourly override is available. Missing names/rates
leave cost unavailable.

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
