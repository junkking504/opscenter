# Phase 2 workspace rollout

The approved workbench anchors are fixed at canvas #f1f6f8, border #dbe4e9 and
muted ink #687e8e. `cssPhaseTwoWorkspaces` activates each workspace separately;
the other workspaces temporarily hold their Phase 1 values. No route, data
adapter, assignment, payment or source calculation changes.

Each workspace decision file accounts for all 350 direct ΔE 2–5 candidates.
Explicit neutral-role decisions supersede candidate merges in one final map,
so no value moves twice. Semantic status aliases retain their names. Alpha
colors and the shared brand file remain unchanged; the dark sidebar is excluded
from workspace palette overrides. Decisions may differ by workspace as actual
foreground/background pairs require. A rejected merge retains its source value.

Command rejects the neutral search-shortcut and blue supporting-text merges:
the first reduced contrast from 3.32 to 3.06, and the second pushed small tabs
and KPI detail below 4.5. Tabs use primary ink on the mandatory fixed canvas.
Source failure reasons also use primary ink. Source labels/actions are 10–11px.
The <=600px header gives search and date controls full rows so OpsWiki is not
covered; control targets stay independent of font size.

The 98 original 6–7px declarations are individually classified in
`small-text-decisions.json`. Phase 2 maps their old type tokens to 10px; larger
winning rules remain larger. None is declared unused merely because a fixture
didn't render it. The test-only selector specimens check all 98 winning computed
sizes at 1280×720, 390×844 and a 640×360 CSS viewport at 2×, alongside real
workspace overflow and hit-target overlap checks. These are complementary to
actual component/dialog and authenticated production review, not a replacement.
The one 8px exception is the nonessential brand strapline, with brand identity
already in the image's accessible name. Other 8px labels become 9px. The mapped
base scale is 9/10/11/12/13/14/16/20/24/28. Larger existing display values await
the separately requested decision; no new large exception is introduced by
Command's rendered views. Legacy source token names remain during the staged
rollout and will be retired after all six workspaces are accepted.

Run `verify:css-phase-two`, `verify:css-architecture`, TypeScript and the normal
build. Start the synthetic fixture with the existing desktop dependencies:
`cd desktop-ui && node_modules/.bin/vite --config tests/css-phase-two.vite.config.ts`.
Open `/tests/css-phase-two.html?workspace=Command&commandMap=1` for real components (add `&sourceCases=1` for source warning/unavailable rows),
and `/tests/css-phase-two-audit.html` for the three viewport/computed-style checks.
All fetches in this fixture are synthetic and writes are blocked. Download the
audit receipt; before/after captures and deploy evidence belong in the task
handoff. Current approval/deployment status is recorded there, per workspace.
