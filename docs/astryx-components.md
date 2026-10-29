# Astryx component adoption

The user chose to retain OpsCenter and Waypoint branding while adopting cleaner
Astryx components on 2026-10-26. This is an incremental migration, with the first
pass kept on a task branch for visual and independent review.

## Current implementation

- Pin Astryx Core and Neutral to 0.7.4 and StyleX to 0.19.0 in both dependency
  trees: Next serves Waypoint; the separate Vite client serves `/desktop`.
- `themes/opscenter/opscenter.ts` extends Neutral, retains system typography,
  and defines the existing #b51935 brand accent with white foreground.
- Build the shared theme with
  `node node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs theme build themes/opscenter/opscenter.ts`.
  Commit the generated CSS, JS and declarations together with the source.
- `components/astryx/BrandTheme.tsx` follows OpsCenter's existing theme event;
  Waypoint stays light. Import the layer-order file before component CSS.
- Do not add Astryx's document-wide reset during incremental adoption. Existing
  clients own their resets; component normalization stays scoped to adopted controls.
- The first migrated surfaces are ScheduleControls in the appointment drawer
  (notes, assignment, call-ahead, cancellation) and Waypoint RouteOverview's map
  expansion and next-appointment controls. Handlers, permissions and source
  verification are unchanged.
- Desktop drawer controls retain 14px text and at least 36px height. On narrow
  screens adopted buttons reach 44px and paired drawer actions stack.

## Validation

Run `npm run build:desktop`, root TypeScript, `npm run verify:css-architecture`,
`npm run verify:waypoint-navigation:browser`, and the Next webpack build.

For the OpsCenter interaction check, start the existing isolated fixture:

```
cd desktop-ui
node node_modules/vite/bin/vite.js --config tests/dispatch-details.vite.config.ts --port 3287
```

From the repository root run `node scripts/test-astryx-controls-browser.mjs`.
It verifies 320/390/1440px in light and dark mode, disabled cancellation without
reason, focus on review, Keep Appointment, readable dimensions, and no writes.
The fixture uses synthetic records and rejects writes. Optional origin override:
`ASTRYX_TEST_ORIGIN`.

Waypoint's existing navigation fixture needed an explicit `manager:false` on
its mocked session, matching the current session contract; without this the
fixture never reaches route navigation. No access policy was changed.

## Remaining rollout

This first pass does not replace every UI component. Next candidates are field
and validation patterns, status badges and empty states, then menus/dialogs.
Tables and navigation require separate screen-level review because their data
density and crew workflows matter. Preserve the fixed desktop navigation and
Waypoint's primary mobile destinations. Compare each migrated surface with
adjacent screens, including phones, before expanding the migration.

Astryx is currently beta. Keep package versions pinned and migrate complete,
bounded surfaces; avoid wholesale replacement of the shared legacy Button
because its render, link and icon contracts differ.

References: https://astryx.atmeta.com/components and
https://astryx.atmeta.com/docs/getting-started.

## All-appointments map

The map appears in both the manager appointment browser and the crew Route
view. Its membership is independent of the selected truck's remaining Route
Order. Manager pins include every appointment in the selected date's authorized
schedule snapshot, including completed, cancelled and unassigned work. Crew
pins include every appointment already supplied by the existing scoped API.
This does not broaden a crew session's access to other trucks.

`lib/waypoint-map.ts` projects saved coordinates and saved approximate fallbacks
without geocoding. Completed and cancelled pins carry status marks. Co-located
appointments share a count marker with individually selectable popup entries.
Unmapped appointments remain in an expandable list; a mapped-appointment list
also supports browsing when tiles fail. The manager truck filter changes the
list, while the map continues to show all available trucks. Map selection uses
the existing detail-opening and unsaved-work guards.

Additional checks: `scripts/test-waypoint-route-map.ts`,
`scripts/test-waypoint-all-map-browser.mjs`, and the existing crew and manager
navigation browser suites. The new map test mocks map tiles and exercises
320/390/1440px, all statuses/trucks, co-location, approximate/missing locations,
selection and expansion. `--serve` on that script opens a synthetic preview on
127.0.0.1:3199; it never connects to operational APIs.
