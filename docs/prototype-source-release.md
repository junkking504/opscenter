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
  These calculations are not yet connected to the rendered Schedule board.
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
