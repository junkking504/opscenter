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

## Current integration status

This is an integration worktree, **not a release-ready build**. The local
`/desktop` reference route requires an authenticated session,
`OPSCENTER_RUNTIME=MAC_MINI_PREVIEW`, `OPSCENTER_DESKTOP_PREVIEW=reference`, and a
loopback request URL. It is unavailable in production. Directly opening the
generated static HTML does not enable fixture mode.

Before enabling this interface in production:

- Replace all sample data, fixed dates, and simulated mutation receipts with
  authoritative data and verified API results. Do not silently fall back to the
  sample records when a source is unavailable.
- Preserve appointment identifiers and JunkWare-issued JK numbers separately.
- Use provider-backed route legs and GPS freshness; never publish fixture travel
  times or guessed on-site states as live evidence.
- Retain role authorization for each workspace and API, shared action persistence,
  idempotency, uncertain-write handling, and source verification.
- Compare every workspace, tab, drawer, and schedule interaction against the
  original in the in-app browser at matching viewport sizes.
- Only after those checks, include the desktop build in the normal immutable
  release and verify the exact authenticated live interactions.

The previous manual UI port remains untouched as prior work. It is not the visual
source of truth for this release.

## Verified integration checkpoint

- All six workspace overview headers, tab groups, and first panels match the
  original's measured geometry at 1280 x 720. Command KPI/alert rows and Schedule
  board/register geometry also match. This is a targeted comparison, not complete
  visual acceptance of every tab and interaction.
- `/desktop?data=live` renders the approved Command component with real daily
  metrics and Slack alerts. Acknowledgement/Control linkage use the shared action
  API, server-resolved source facts, expected versions, and database audit records.
  Unsupported workspace actions in this integration view are gated rather than
  running the prototype's local simulations. The reference view remains intact.
- `/api/desktop/schedule` exposes the existing JunkWare normalization and fast
  schedule precedence with separate appointment IDs and JK references. The
  extracted parser remains aligned with the deployed Schedule implementation;
  finish consolidating its shared ownership before future parser changes.
- Route-leg calculations preserve separate appointments even with a shared JK,
  retain overlaps, require verified geocodes, and accept distance/time only from
  the existing routing provider. No prototype travel-time fallback is used.
  The live integration now renders these results in the truck board and full
  appointment register, with a selected-appointment closest-truck comparison.
  Missing provider data stays unavailable rather than using prototype estimates.
- The source-preservation, honest-empty-state, estimate/job KPI, and essential
  alert-fact tests pass. Shared database tests passed concurrent creation, durable
  read-back, audit attribution, version conflict, and resolution checks using
  isolated synthetic preview records only; those records were cleaned up.
- In-app browser QA also confirmed a real source alert could be acknowledged,
  survive reload, and then enter Control through the preview database. This did
  not acknowledge or resolve an alert in production or send anything to Slack.
- Both the isolated desktop build and the complete Next.js application build
  pass. Targeted server/adapter lint passes. Existing framework Edge Runtime and
  middleware deprecation warnings remain; the desktop bundle also reports a
  code-size warning. The normal release build is not switched to this frontend.

Next: connect Schedule's approved board/map/register/drawers to the typed source,
replace its JK-only internal identity and integer-hour placement assumptions,
wire verified mutations, and complete Control, Monitor, Krewe, Fleet, Marketing,
and Finance data/action adapters. Do not deploy the partially connected view.

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
