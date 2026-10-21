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


---

# Waypoint phone connection design QA

Source visual truth: /Users/missioncontrol/.codex/generated_images/01a15f2b-16dc-71b1-b603-5e591f6f4228/exec-4d8f54c8-854a-43d7-986e-9373fb7973b4.png
Implementation: http://127.0.0.1:3198/crew-jobs (production build through local synthetic API fixture).
Implementation screenshot: /Users/missioncontrol/Documents/Codex/2026-10-21/we/outputs/waypoint-entry-390.png
Viewport: 390 × 844 CSS px, deviceScaleFactor 1. Source 853 × 1844 pixels normalized to 390 × 844; implementation 390 × 844. No browser/device chrome.
State: unconnected phone, Phone #1 · NOLA selected, no request sent.
Full-view comparison: /Users/missioncontrol/Documents/Codex/2026-10-21/we/outputs/waypoint-entry-compare.png
All typography and controls are readable in the paired 800 × 844 image; a separate focused crop was unnecessary.

## Findings and comparison history
- Initial P2: header and form spacing pushed primary action/progress too far down. Evidence: waypoint-entry-compare-v1.png. Fixed compact header (36px brand icon, 12px vertical padding), intro gap, action and progress spacing. Post-fix evidence: waypoint-entry-compare.png.
- Initial P2: a simulated failed network response exposed “Failed to fetch.” Fixed with explicit WhatsApp/status recovery copy. Final browser verification is recorded in task evidence.
- No remaining actionable P0/P1/P2 visual findings. The source uses smaller generated text than its nominal 390px brief. Implementation uses legible 14px body text and 16px controls; WhatsApp copy wraps naturally at 390px. This accounts for the extra line and lower subsequent content while preserving hierarchy. Header title aligns with the reference; all three steps remain in the viewport.

## Fidelity surfaces
- Typography: existing Inter variable font, 30px/750 primary heading, 14px secondary instructions, 16px inputs/actions. User's exact wording preserved. At 320px heading is 28px and fits; no truncation.
- Spacing/layout: 28px horizontal padding, 48px primary targets, same sequence and section grouping. Scoped styles leave connected crew views unchanged. 320 and 430px captures confirm no horizontal overflow.
- Colors/tokens: existing warm off-white, charcoal, deep red, and gold. Flat button (no raster generation shading). Disabled initial action is distinctly neutral. Visible focus outline retained.
- Assets: original production crown PNG, not a generated substitute. Its original rounded background is retained intentionally. Native select indicator is platform appropriate; secondary text button needs no decorative chevron.
- Copy/content: approved large “Connect Your Phone”; requested instructions appear once. Smaller staged progress labels preserved. Existing recovery actions remain available under Need help connecting.

## Interactions checked in the in-app browser
Manual code entry focuses its input; invalid code shows recovery; reload restores a pending attempt; Choose phone returns to selection and clears current input; a simulated request reveals code entry; accepted and lost-response status retries reuse the same saved request ID after reload; uncertain results remain explicit; ten-minute new-code guard remains; successful synthetic enrollment verifies cookie readback and opens daily truck setup. No real WhatsApp messages or phone enrollment performed. No unexpected console errors; failed network response was intentional.

## Open questions and follow-up polish
No open design blockers. Physical iPhone keyboard/safe-area testing remains a device verification limit. 14px instructions intentionally favor legibility over the mock's smaller raster text. Future polish of connected screens is outside this entry-screen change.

## Implementation checklist
- [x] Match selected design and requested wording.
- [x] Preserve real brand asset and protected enrollment flow.
- [x] Compare 390px reference and implementation together.
- [x] Check 320/430px layouts and core fixture interactions.
- [x] Resolve actionable visual issues.

final result: passed
