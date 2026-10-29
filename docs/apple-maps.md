# Embedded Apple Maps

The current `/desktop` Command schedule and Operations Map can display Apple
Maps through MapKit JS 6. Both use `desktop-ui/schedule-map.tsx`; it retains the
same pin model, labels, keyboard buttons, selection/follow behavior, territory
framing and GPS trip display for both map providers. The limited renderer facade
is `desktop-ui/lib/map-engine.ts`, with Apple in `apple-mapkit.ts`.

## Activation

The authenticated, private/no-store `GET /api/desktop/maps` endpoint reads:

- `OPSCENTER_APPLE_MAPS_ENABLED=1`
- `OPSCENTER_APPLE_MAPS_TOKEN`: a **MapKit JS browser token**, restricted to the
  exact production website `ops.junk-king.app` in Apple's portal.

Store values in protected runtime configuration outside Git. Never put a private
signing key, Server API token or account credential in this browser-token setting.
The browser token is necessarily visible to authenticated browsers; Apple's
website restriction is its scope boundary. No `NEXT_PUBLIC` or build-time token
is used. Tokens may expire; record the chosen expiry in the private task packet
and rotate before expiry. This change neither creates nor renews credentials.

Disabled/missing configuration keeps OpenStreetMap. The original map renders
while configuration/SDK loading is pending. A failed or timed-out SDK load or
Apple configuration error returns to OpenStreetMap and labels that fallback.
Only one SDK load is attempted per page. Authorization and runtime errors remain
failed across component remounts, avoiding repeated counted map creation. The
page can be reloaded to retry. Manual gestures are observed at host capture phase
so SDK event handling cannot prevent pausing Follow.
Apple's logo and attribution are retained. Dark mode follows `data-ops-theme`.
Map listeners, tooltips, annotation layers and observers are removed on teardown.

When enabled with a token, middleware adds the MapKit CDN to the existing CSP:
scripts from `cdn.apple-mapkit.com`, images/connections/frames/workers from
`*.apple-mapkit.com`, and blob workers. When disabled these additions are absent.
The existing enforcement setting is retained. Check the effective policy and
browser violations during activation, including tiles and worker loading.

## Scope and evidence

Only the `full-map` library loads. No Apple geocoding, search, directions,
road matching, or traffic estimate calls are added. Existing exact, approximate
and area-only coordinates and labels retain their meaning. GPS paths and gaps
remain supplied by the existing recorded-GPS model; changing the basemap does
not turn them into Apple-generated directions or verified street tracks.

Route Order's separate map, legacy `/jobs`/`fleet` maps and existing ETA/address
providers remain on their current implementation. Outgoing Apple Maps navigation
links are a separate change. A browser mock verifies local integration logic;
it does not establish a live Apple SDK/account result or physical phone behavior.

## Usage and release

Apple currently includes 250,000 map views and 25,000 service calls daily with
Developer Program membership. This feature uses map views only. No additional
capacity purchase or usage charges are authorized. Do not add service libraries
or increase paid capacity as part of activation. See [spending controls](spending-controls.md).

The source endpoint inventory adds `cdn.apple-mapkit.com`. Apple's SDK contacts
Apple-managed map/configuration/CDN services internally. Inventory scanning is
not a browser network firewall. Exact-commit independent review, the installed
inventory review/update and authenticated live rendering checks remain release
prerequisites. No installed checker, protected-file hash, paid approval or budget
is changed by this implementation.

## Verification

`npm run verify:apple-maps` checks fail-closed activation, scoped CSP, early and
runtime authorization failures, no retries after failure, and map layout. It is
also included in the build checks.
The fixture `desktop-ui/tests/apple-maps.html` exercises the real ScheduleMap
against a synthetic SDK with known exact/approximate coordinates, selection,
responsive width, theme and teardown. Existing GPS trip, heading and map-layout
checks still apply. Check a live map, pin selection, truck follow, View Routes,
manual pan/zoom, theme, attribution and fallback before reporting activation.

Sources: [Token setup](https://developer.apple.com/documentation/mapkitjs/creating-a-maps-token),
[MapKit JS loading](https://developer.apple.com/documentation/mapkitjs/loading-the-latest-version-of-mapkit-js),
[Included allowance](https://developer.apple.com/maps/web/).
## Map navigation

Vertical two-finger scrolling and mouse-wheel input zoom the embedded map around the pointer, including the control-wheel events browsers use for trackpad pinch. Native touch pinch and dragging remain enabled. Manual gestures pause truck following. The adapter removes its wheel listener when the map is destroyed.
