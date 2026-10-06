# Convoy dashboard implementation QA — 2026-10-06

Source visual truth: Figma file `ZaI36Pl4AO0QCUrlesA6cQ`, nodes `2:2` (Overview),
`2:3` (Service), `2:4` (Truck detail). Editable source design was inspected with
Figma design context and screenshots.

Evidence directory: `/Users/missioncontrol/Documents/Codex/2026-10-06/we-x20/work/`.
Source captures: `figma-overview.png`, `figma-service.png` (1440 × 1320).
Browser-rendered implementation: `convoy-overview-final.png` (1440 × 1320),
`convoy-service-final.png` (1440 wide, full page), `convoy-mobile-final.png`
(390 wide, full page), and `convoy-mobile-form.png` (390 × 844).

Combined comparison inputs: `convoy-overview-comparison-final.png` and
`convoy-service-comparison-final.png`. Both use the same 0.5 resize of the
source and implementation, side by side, without stretching. Desktop CSS viewport
was 1440 × 1320, device scale factor 1. Mobile viewport was 390 × 844, scale 1.
The in-app native window capture crops an emulated viewport; these comparisons
use the browser's full-page screenshot instead.

State: synthetic preview at `/desktop-assets/tests/convoy.html`, future operating
Date October 9, with current independent mileage readings, stale/conflicting/
missing readings, open repairs, scheduled work and initially missing baselines.
Synthetic values differ from the design's October 6 source snapshot. The shared
production shell, date navigation and search are intentionally retained; the
fixture's abbreviated shell is not a replacement for them.

## Findings and fixes

- Extra freshness/action rows initially pushed the dashboard below the main
  workspace content. Moved primary actions beside the heading and detailed source
  timing below the dashboard. Coverage remains beside the truck table.
- Initial preview assets were unavailable under Vite's development base. Linked
  the exact production wordmark/font for the local fixture and loaded the fixture
  font under its preview path. Production uses its existing `/fonts` and wordmark.
- Mobile service table originally required sideways scrolling to reach actions.
  Changed narrow layouts to two-column record cards, exposing next targets and
  actions. Final evidence shows document width 390 and service table width 372,
  with no page overflow. The 358-wide modal fits the viewport with a scrollable
  804-high body and 20-pixel top margin.
- Post-fix captures were reviewed against the source in the combined comparison
  images. No remaining actionable P0/P1/P2 findings within the implemented scope.

## Required fidelity surfaces

- Typography: bundled Inter; 32px titles and metrics, 18px section titles,
  13–14px operational text, 11–12px labels. Form labels use normal case. Readable
  table and form region captures were examined at full size, not only thumbnails.
- Layout: four summary cards, truck table with attention/coverage side column,
  service planning bar, scheduled work, interval controls, truck detail and dialogs.
  Existing shared shell retained. Extra interval target/status columns are required
  for the now-functional workflow. Mobile cards are an intentional adaptation.
- Colors: white panels, muted green-gray canvas, #255e4c primary actions,
  #eaf3ef source guidance, #fff1d6 warnings, #d7dbd7 borders, 8px radii.
- Assets: exact existing OpsCenter wordmark; no generated replacement. Lucide
  action icons supplement the source layout. No new decorative imagery.
- Content: real source values are populated at runtime. Unknown maintenance is
  not presented as current. Scheduled and completed work stay separate. All costs,
  mileage quality, intervals, dates and counts derive from records.

## Interaction evidence

Browser checked all five tabs; truck detail/back, mileage-review filter (six test
trucks), search (one matching truck), interval save/read-back (5,000 miles or six
months), completed service save (117,000 service miles with current 121,000),
122,000 next-mileage target and 1,000 miles remaining/Due soon. Edited service date
with the native calendar and confirmed next-date recalculation. Scheduled-record
review retained Scheduled and its original date. Form cancellation and mobile
layout were checked. No live service or repair records were fabricated for testing.

Console check: development hot reload of the standalone fixture produced the
known duplicate-createRoot warning while editing its entry file. No application
exception was observed during a cold-load interaction pass. Production acceptance
is separate from this synthetic visual/functional QA.

Follow-up polish: sidebar and operating-day shell retain their established
production spacing; the supplied design's demonstration sidebar was not shipped.

final result: passed
