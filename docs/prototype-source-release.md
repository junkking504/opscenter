# Approved Desktop Source Release

The approved interface is the actual prototype, not a second implementation of
its design. `desktop-ui/app/page.tsx`, `desktop-ui/app/globals.css`, and its four UI
primitives were imported directly from the approved source. `approved-source.json`
records their original hashes. Keep its dependency lockfile independent from the
legacy application so Tailwind 3 cannot change the approved Tailwind 4 cascade.

## Build and runtime boundary

`npm run build:desktop` type-checks the desktop package and builds its assets with
the pinned prototype dependencies. The Vite adapter changes the hosting target,
not the visual components. The existing OpsCenter server handles authentication,
authorization, data, and source-system mutations. No second production port or
iframe is required. Never edit or stop the original port-3101 preview.

## Production integration (September 4)

The normal `npm run build` now builds the pinned desktop package before Next.js.
Authenticated `/` opens `/desktop?data=live`; monthly reporting and explicit
`legacy=1` links retain the existing application. Production always uses live
adapters. Fixture rendering requires an explicit `data=reference` request, a
loopback URL, and both `MAC_MINI_PREVIEW` and the reference-preview flag.
The original port-3101 prototype is preserved and must not be edited or stopped.

All six workspaces use source data and retain the approved component hierarchy,
CSS, primitives, and dependency lock. Missing inputs remain unavailable rather
than falling back to prototype records or simulated successes.

- Command: source metrics and Slack alerts, shared PostgreSQL decisions, actor and
  reason audit, optimistic versions, day start/close/reopen, carryovers, pagination,
  exact action links, and source reconciliation. Manual completion is labeled as
  an OpsCenter decision; source completion requires verified source observations.
- Schedule: board/map/register, fractional windows, separate appointment IDs and
  JK references, provider-backed routing, guarded drag review, notes, call-ahead,
  cancellation, reviewed creation, and JunkWare closeout. Calendar distinguishes
  a verified empty schedule from unavailable data. Follow-Up uses actual estimate
  links and photo-audit availability. History explicitly covers saved OpsCenter
  operations rather than claiming complete JunkWare history.
- Krewe: roster, call-in plan, pay periods, monthly summaries, and guarded time/pay
  corrections. Missing overtime inputs remain unavailable. Source-only assignment
  actions stay in their authoritative workflow.
- Fleet: GPS/readiness, inspection and maintenance records, work orders, service,
  reports, and actual load observations/resets. Missing load records stay unknown.
- Marketing: SearchKings leads and outcomes, Podium review attribution, and sourced
  performance. Finance: reconciliation, payments, resale inventory and an
  OpsCenter-owned recycling evidence ledger. Recycling entries do not claim a QBO
  posting, and payment changes without a supported source writer remain read-only.

Source mutations require authenticated roles, same-origin checks (including the
trusted proxy origin), actor-bound request IDs, current source versions, and
read-back. Creation additionally guards equivalent booking identities across
request IDs. Post-write failures remain uncertain and block blind retries.
Control uses the shared PostgreSQL audit. Schedule, creation, people/fleet and
commercial adapters use private durable runtime receipt journals; these are not
misrepresented as PostgreSQL audit records. Runtime data and protected environment
files stay outside Git and immutable release directories.

## Desktop interaction repairs (September 4)

- Workspace and view selections update the URL; a reload restores the active
  workspace, subview, and Schedule day.
- Schedule territory controls focus on matching appointment coordinates, with
  the existing territory center as the empty-territory fallback. Distant trucks
  do not keep a territory at the all-locations zoom.
- Map pins and schedule rows select the same appointment/truck. Appointment
  selections open the source-backed detail drawer. Truck selections focus GPS
  and expose crew, status, appointments, the Fleet record, and LinxUp video.
- Overlapping appointment and truck pins have deterministic display offsets
  with leader lines to the unchanged source coordinates. Escape/All resets focus.
- The desktop reuses `TruckCameraController`; Vite deduplicates React so the
  shared component uses the desktop renderer. Playback still depends on the
  truck having an assigned and available LinxUp camera.
- Live Krewe, Fleet, and Marketing tables use scoped compact styles and local
  horizontal scrolling at narrow widths. Command alerts disclose full facts
  through Details without changing workflow state.

## Release validation

The desktop and complete Next.js builds, source-preservation checks, CSS ceiling,
production-lineage gate, and focused adapter contracts pass. Control concurrency,
transaction rollback, pagination beyond 200 rows, day lifecycle, source observation
reconciliation, and exact action lookup passed against an isolated disposable
PostgreSQL database. No production database records were used for those tests.

Authenticated browser checks at 1280 x 720 cover all six workspaces and their
primary tabs, source data/error states, booking and closeout forms, correction and
inventory drawers, and a truck/time drag proposal that was canceled. No customer,
payroll, financial, or Slack mutation was submitted during this release's browser
checks. Deterministic tests cover write identity, roles, conflicts, exact read-back,
uncertain outcomes, and failed receipt persistence. A failed or unavailable source
is not a successful empty result.

Desktop asset size and existing Next middleware warnings remain. Deployment,
service health, public routing/revision, and authenticated production rendering
are separate gates; a successful local build does not establish a live release.
Mission Control activation alone does not establish that the public hostname has
stopped serving the VPS. Follow the canonical controlled release path and check
both explicitly.

## Historical integration checkpoints

The following notes describe the earlier September 3 integration state. Their
remaining-work statements are superseded by the production integration above.

## Schedule repair checkpoint (September 3)

The live Schedule adapter now mounts successfully with real appointments and
separate source IDs, fractional-window placement, the map, territory register,
and appointment drawer. Dragging proposes a truck/time change and requires an
explicit review before submitting. Notes, call-ahead, cancellation, and assignment
controls call existing authenticated handlers. A private runtime receipt journal
guards source versions and duplicate/uncertain submissions, including new request
IDs for the same appointment. These write paths have deterministic synthetic
tests; no live customer appointment was changed for testing. Creation, closeout,
Calendar, Follow-Up, History, and the remaining workspaces still need integration.

The original prototype CSS, UI primitives, and dependency hashes still pass.
Desktop build, application type-check, and operation contract tests pass at this
checkpoint. Browser QA confirmed rendering, but full drag/drop and visual parity
acceptance are not yet complete. A full release build has not been repeated after
these changes. This is still not a production-ready release.

The routing preview initially lacked the configured Google credential. Loading
only the existing routing credential into its process exposed an independent
Google restriction: IPv6 requests return `API_KEY_IP_ADDRESS_BLOCKED`; IPv4 gets
past that restriction but returns `API_KEY_SERVICE_BLOCKED` for Routes API.
After the user enabled two-step verification, Routes API was enabled in the
existing Google Cloud project and added to the Maps Platform API Key allowlist.
Saved settings were read back: Places API (New) remains allowed and the existing
IPv4 restriction is unchanged. Google's active-usage warning referenced Geocoding,
which was already absent from the saved allowlist; no access was removed. No key
was rotated or exposed, and billing/account settings were not changed.

Google Routes requests now use a provider-scoped IPv4 HTTPS transport with the
same timeout and restricted server key. Adjacent appointment legs request one
billable matrix element each (at most four concurrent requests), not an N-by-N
matrix. Cached results retain their actual calculation timestamp. The UI reports
partial routing availability rather than suggesting every route succeeded.

A public-coordinate provider probe returned ROUTE_EXISTS with 23,815 meters and
1,289 seconds. In-app browser QA of `/desktop?data=live` confirmed real Schedule
travel labels, including verified legs of 18 minutes / 8 miles and 20 minutes /
9 miles. These are current-traffic
planning estimates, not reconstructed historical drive times. Missing verified
locations remain unavailable. No customer appointment was changed.

The routing transport, schedule contracts, and application type-check pass.
The live board uses its measured header height rather than subtracting a fixed
44 pixels, so the final truck row is not clipped by a taller source-data header.
Rebuilt-browser QA at 1280 x 720 confirmed all eight truck rows inside the panel
and viewport (last row bottom 713.78px), plus 9 of 12 route legs available. The
remaining routes are explicitly unavailable; no travel numbers were invented.
Production service, collectors, and the original port-3101 prototype remain
unchanged. The Google access change is live; the frontend integration and IPv4
transport code are still local and must pass the remaining release gates above.

## Schedule interaction verification (September 3)

In the authenticated live-data preview, both vertical truck reassignment and
horizontal retiming reach an explicit review without writing to JunkWare. The
review now displays the complete destination window, including its end time.
Escape dismisses it and returns focus to the original appointment without
scrolling the board. The drawer's truck/time selectors use the same review and
detect source appointment overlaps, including distinct records sharing a JK.

Unchanged assignment values cannot be submitted from the drawer. Closed records
remain non-movable. Pending/manual-correction assignment state is visibly labeled
and blocked from another move in both the UI and server, independently of the
desktop receipt journal. In-flight operations prevent closing the drawer or
changing its local operating day. Reading an uncertain receipt no longer triggers
the verified-save callback.

Note and cancellation controls reuse the prototype's compact action layout. Empty
notes/reasons stay disabled; cancellation requires a second explicit confirmation.
Browser QA entered and discarded draft inputs and canceled every move/review.
No live customer record was submitted or changed. Actual source writes still
require deliberate test-safe acceptance; deterministic lifecycle tests cover
versions, roles, duplicate/uncertain writes, and the new assignment guard.

The desktop build, complete Next application build, both TypeScript projects,
source-preservation checks, and schedule interaction/operation tests pass. Existing
framework middleware/Edge warnings and the desktop bundle-size warning remain.
Next: connect the approved New Appointment form to the existing verified creation
workflow, then complete the remaining category-specific closeout and Schedule tabs.
This is an integration checkpoint, not a production release.

## Mission Control public routing (September 4)

Production runs on Mission Control. The old shared Cloudflare tunnel still has
both Mission Control and VPS connectors, but the VPS now forwards its loopback
port 3000 over authenticated SSH to Mission Control's loopback port 3000. Both
public paths therefore reach the same application, runtime data and PostgreSQL
store. Existing hostname Access and signed-webhook policies are unchanged.

The private relay is a Mission Control LaunchAgent,
`com.opscenter.vps-origin-relay`, using the existing deployment SSH identity,
`ExitOnForwardFailure`, 15-second keepalives and automatic restart. Its VPS bind
is `127.0.0.1:3000`; no public application port was opened. The former VPS
application and assignment retry containers are stopped. Do not run the unchanged
VPS `push-app.sh`, which would restart both and conflict with the relay port.

A dedicated `opscenter-mission-control` tunnel was also prepared and connected.
Its direct DNS cutover remains pending access to the account/zone owning
`junk-king.app`. Existing local certificates are scoped to `jkops.live`; the two
incorrectly suffixed records created during the attempted CLI cutover were
verified and removed. Never treat a successful tunnel command as proof of a
correct hostname change. No paid Load Balancing service was enabled.

Before replacing the VPS app with the relay, shared-state manifests matched:
the only differing assignment fields were retry timestamps, not truck, time,
source status, or other business values. The VPS retry worker was stopped between
runs. The Mission Control collector now calls the existing one-way `initial`
sync mode, publishing data and shared state without pulling VPS copies back.
The VPS is a routing relay, not a verified hot standby. Direct tunnel routing and
independent code/database failover remain separate infrastructure work.


### Command operations map

Command's Alerts view includes a collapsible Operations Map below the KPIs.
It uses the same live Schedule map, territory focus, appointment drawer, truck
selection, camera controller, and mutation guards. The compact mode loads only
the selected operating day and requests route comparisons after appointment
selection. Collapsing unmounts the map, stops its polling, and cleans up camera
sessions. Visibility is remembered in browser storage; first use on mobile starts
collapsed. Open Schedule switches to the selected day's board.

Shared map details use compact headings and actions. The optional Leaflet prefix
is removed; the OpenStreetMap attribution remains visible and linked.
Appointment symbols are 18px territory-colored circles; trucks use a numbered
truck silhouette. Both retain 30px click targets and collision separation.

Schedule blocks keep their territory color across estimate and completion
states. JK numbers wrap within narrow blocks instead of truncating. Overlapping
appointments receive enough lane height for the identifier; the board scrolls
locally when its rows exceed the available panel height.

Map hover labels show only the JK number and appointment window, or the truck
number and GPS freshness. They wrap within 150px and clamp to the map canvas;
full accessible labels and click-through details remain available.

Dragging can begin on the block or JK number. Pointer capture and temporary
selection suppression prevent native text selection; drop still requires the
existing review and verified JunkWare write. Clicks after a drag are suppressed,
and Escape, pointer cancellation, blur, or unmount clean up the gesture.

Unavailable route labels distinguish an unverified appointment address from a
missing provider estimate. Coordinates remain subject to the existing strict
verification; the interface never substitutes invented travel times.
