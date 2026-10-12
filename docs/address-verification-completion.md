# Address verification completion

Every collected appointment address remains eligible for free verification and urgent oversight until verified, including completed, closed, canceled and unassigned records. Appointment outcome cannot clear an address failure. Square/SQ is a formatting equivalence; directions and house numbers must still match. Provider failures must remain visible and owned, with escalation. Verification cannot be fabricated to satisfy coverage. Evidence-backed source corrections use the durable reviewed-address store and preserve the original source field.

The paid research candidate scope and spending approvals remain unchanged. Completed and canceled records are covered by ordinary free verification and urgent ownership, without expanding paid usage.

Street shorthand `Str`/`Str.` is normalized to `Street` for provider queries and exact matching. Full-field candidate parsing recognizes it even after a numeric business label. Original source text remains available; house, direction, street, locality, ZIP and multiple-premises checks still apply. Policy 14 invalidates prior failed lookups so existing automatic sweeps retry with the corrected parser. No provider or spending limit changes.

Policy 15 removes straight and typographic apostrophes only inside alphabetic words before matching. Source `Settlers` therefore matches official `Settler's`, and `O'Neal` matches `ONeal`; spaces, house identifiers, directions, road types, ZIPs, buildings and distinct street words remain guarded. This is a shared normalization rule, not a customer-specific override. Old negative verification caches and background attempt delays are invalidated by the policy version.

The automatic minute sweep retries unresolved addresses on a five-minute cadence (or the provider's explicit backoff), rather than delaying an ordinary failure for six hours. Every run records total unique addresses, mapped and unresolved counts, an explicit completeness flag and the unresolved addresses across all collected current/future dates. A run with some successful lookups does not establish complete coverage. Existing all-outcome oversight and paid spending limits remain in force. Incomplete or contradictory source addresses still require evidence-backed recovery for exact-property verification. Map display may independently use the best available provider candidate as described below.

Policy 16 adds direct St. Tammany Parish Communications District address points to the existing free parish preflight, shared request limit and durable evidence cache. This recovers new-construction addresses missing from Census or downstream geocoder snapshots automatically. Exact house, complete street, city, ZIP, geographic bounds and a single authoritative point are required; explicit buildings stay unresolved without building evidence. Neighboring-house suggestions are provider coverage failures, not competing exact premises or evidence that the source address is illegitimate. Old failures retry automatically.

## Map display and exact-property verification

As requested on October 12, 2026, Control and Job Order select the best available approximate pin when existing parish, OpenStreetMap or Geocodio results contain multiple plausible matches. Matching still requires the same house, street stem, locality and compatible state/direction. Candidates rank by the requested unit, premises/entrance availability, exact road suffix, ZIP, freshness, provider and precision; a stable identity breaks ties. Bare building-unit notation such as `26-107` can match provider unit `26107` for approximate mapping without exact-property verification. When that unit is absent, a complex entrance is preferred over another apartment. Partial parish results can supply display evidence without implying complete coverage. East Baton Rouge and St. Tammany parish caches are both supported.

The board shows the selected point as Approximate and provides an Open pin link; ambiguity no longer asks the dispatcher to confirm or correct an address. A truly missing usable map result is labeled Pin unavailable (No pin in the coverage count) and existing background lookup continues. Street suffix corrections, duplicated localities, a locality word omitted from the road name and differing ZIPs may supply display evidence. Explicit conflicting states, directions, house numbers, unrelated streets and invalid coordinates cannot. Out-of-state display points are supported within the continental US. The source address remains unchanged, and the candidate address and source remain inspectable.

This fallback reads the existing bounded provider caches; it creates no additional provider calls or spending. Recent expired cache evidence remains available for up to seven days with an explicit last-result label. Verified coordinates always win. Approximate points never enter `planningLocation` or the shared verified geocode cache. The October 12 arrival/departure policy below separately admits labeled approximate visit evidence. The board counts map coverage separately from verified-property coverage and continues exact verification in the existing worker.

When OpenStreetMap returns only a road, its point may supply an approximate pin if the complete road name, direction, locality, state and ZIP match. The result must be an identified road way with valid bounds containing its coordinate and spanning no more than 0.03 degrees on either axis. Long highways and locality centroids do not qualify. Matching house-level candidates always rank ahead of street-only results. Pin details identify the street-level estimate without claiming that the house was located; the original house number stays on the appointment. This reads the existing search response and adds no lookup or spending.

An otherwise unparseable address ending in `Cr` immediately before its comma-separated locality and ZIP can try `Cir` as an approximate OpenStreetMap query. Alphanumeric house numbers and the original source remain intact; prefix `CR 123` county-road expressions are untouched. This uses the existing free OSM lookup slot, cache and request limits, with no additional call after an ordinary supported query. Exact verification still uses the original source and does not confirm the guessed suffix. Geocodio map candidates retain `unit_number` (or legacy `secondarynumber`) so a matching apartment can rank ahead of a complex entrance.

## Approximate travel estimates

At the operator's request, schedule road legs, Job Order previews, closest-truck comparisons and live truck ETAs may use the approximate map pin when no verified location exists. Results carry an `approximate` flag and visible Approx./≈ labels; details explain the candidate location. Existing OSRM road routing and rate limits apply, without traffic data. Route cache identities include fallback evidence so a changed candidate or verified replacement recalculates the estimate. Missing routes remain unavailable and existing parked/stale GPS rules still apply to live arrival times. This does not change the verified `location` field or address records. Approximate travel estimates do not create visits; the separate GPS policy below governs arrival/departure detection.

A source house with one appended letter (for example `110A`) can use a provider's same-number base building (`110`) as an approximate display/ETA fallback. The full street, direction, locality and ZIP must match, and any explicit provider unit must agree with the source letter. Exact full-house candidates rank first, followed by matching-unit buildings, then the base building. The original source address stays visible; details name the unconfirmed letter. Different numeric houses, conflicting letters, ranges and multi-letter suffixes are not collapsed. No verified location is created; GPS visits use the separately labeled policy below.

Street parsing recognizes `Trace` and postal abbreviation `Trce`; normalization treats them as the same road type without changing the source address or house identifier.

The same bounded `Cr` display query also replaces an otherwise unsupported Geocodio query in the automatic worker. It uses the existing single free lookup slot, cache, deadline and limits, including after evidence expires. The transformed query can populate approximate evidence only; its verification result cannot promote the original source to a verified location. Provider backoff remains honored.

## Approximate arrival and departure pins (October 12, 2026)

At the owner's explicit request, arrival and departure detection may use the
same best available cached map point shown by Control/Job Order, including
bare building-unit notation. `appointment-visit-pin.ts` keeps this separate
from verified `location`. Original addresses, verification status, cache policy,
provider requests, rate limits and spending controls are unchanged.

The OpsBot adapter reads existing caches through `read-appointment-visit-pins.ts`.
Confirmed GPS evidence at an approximate pin carries `visit_pin.approximate`,
the source address, candidate address, provider, stale flag, detail and coordinate.
`match_confidence=confirmed` describes the admitted GPS visit, not the address;
`match_status=approximate_pin` and the match reason preserve that distinction.
JSON and CSV preserve the pin; Command and Slack alert text say Approximate,
and Schedule visit blocks show ≈ with Approximate pin in accessible details.
A persisted day's approximate pin stays fixed across cache refreshes (including
later exact verification) while its source address is unchanged. Departure
reconciliation uses the recorded pin rather than a newly moved display point.

A single observation within 200 metres establishes presence. Overlapping
200-metre appointment circles (pin centres within 400 metres), when either pin
is approximate, suppress both candidate matches. Completed nearby appointments
still count; cancellations do not compete. Truck assignment and appointment
windows cannot break that tie. This deliberately leaves dense complexes for
review rather than guessing the stop. Verified/verified matching is unchanged.

Approximate collector departures require two distinct valid fixes beyond
400 metres, at least one minute apart, with no gap above five minutes, and the
existing five-minute exit grace after the last inside observation. Duplicate
or conflicting same-timestamp samples cannot corroborate exit. Shared live
reconciliation retains its two-fix/one-minute bounded-departure rule and never
claims an exact exit or duration from those bounds. A single-point visit can
close with zero measured duration; it does not invent time on site. Future GPS
is rejected. Old observations may describe a historical visit but never become
current presence; normal parked/moving freshness rules remain in force.

On the first ordinary matcher run after approved activation, the adapter
exclusively publishes `data/config/approximate-visit-policy.json` with an
`enabledAt` cutoff. Approximate matching ignores earlier GPS. That durable cutoff
survives retries, process restarts and future releases; never delete/reset it to
replay history. Invalid state fails closed. Tests inject a cutoff or use a
private temporary directory. No live matcher should be run merely to test this
change. Current UI observations can show approximate presence independently of
the slower persisted ledger; they do not publish historical events.

Approximate visits remain excluded from automatic JunkWare truck assignment,
even if the address is subsequently verified. Detection does not confirm the
address, close an appointment, change a source booking, or alter payments.
Run `npm run verify:approximate-visits` for synthetic integration, including the
installed matcher/validator with temporary inputs and mocked output writers.
