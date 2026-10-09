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
base scale is 9/10/11/12/13/14/16/20/24/28. Scope overrides resolve legacy
6–27px token references onto that scale. Legacy root definitions and token
spellings remain for shared and excluded surfaces; they are not a claim that
all source definitions are on-scale. Do not globally rewrite those compatibility
values as part of this six-workspace migration.

Expanded views: Capital Trends KPI values resolve to20px and Campaign detail
heading/Results hero to20/28px, because more-specific existing rules override
legacy30/36/42px declarations. Convoy truck-detail `.convoy-metric > strong`
previously rendered32px; its Fleet-only32 token now resolves to28px, following
the explicitly approved maximum with a before/after detail-view comparison. No
larger exception is introduced. Report audited views by name,
not as proof that every possible view has been rendered.

Guard boundary: `verify-desktop-tokens` scans top-level `desktop-ui/*.css` and
`desktop-ui/app/*.css`, not nested components or mobile-closeout. It is a source
check, not an installed deployment gate. Component-local styles therefore also
need rendered review: Command explicitly overrides both operational/photo
headings18→20 and payment text15→16. The separate crew mobile closeout surface
and concurrently owned SpecOps styling are outside this migration. This is not
a recursive zero-raw-CSS claim.

Run `verify:css-phase-two`, `verify:css-architecture`, TypeScript and the normal
build. Start the synthetic fixture with the existing desktop dependencies:
`cd desktop-ui && node_modules/.bin/vite --config tests/css-phase-two.vite.config.ts`.
Open `/tests/css-phase-two.html?workspace=Command&commandMap=1` for real components (add `&sourceCases=1` for source warning/unavailable rows),
and `/tests/css-phase-two-audit.html` for the three viewport/computed-style checks.
All fetches in this fixture are synthetic and writes are blocked. Download the
audit receipt; before/after captures and deploy evidence belong in the task
handoff. Current approval/deployment status is recorded there, per workspace.

Claude review follow-up: Command KPI captions now use 10px primary workbench ink
(#243b4d) on all five card tints. Operational updates had two component-local
raw sizes outside the token inventory; their heading is20px and payment text
16px under the Command scope. The library's plus/minus map glyph sizing stays
icon geometry, not operational text.
Control uses the same reviewed role direction with its own decision record. It
retains natural timeline lane heights instead of compressing the schedule;
dense days use the existing scroll area. Map count chips sit below the focus
label after small-text enlargement. Long synthetic customer names wrap in the
appointment and Job Order dialogs, with controls still accessible and Escape
closing Job Order. Leaflet's plus/minus glyphs retain the library's icon sizing;
they are not operational text or a larger display-text exception.

Capital keeps source-unavailable states and financial values intact; only its reviewed palette and type profile change. Reconciliation and overview were checked on phone and desktop without submitting a payment action.

Concurrent SpecOps remains outside the approved six-workspace migration. Its stylesheet is preserved byte-for-byte from production `3a0eb7f0` (SHA-256 `1e7f411d7f2d583eb798daf38816747c5a298e20154713844e62afceb08fcba6`), updating the former `036462cf` baseline after the owner’s conditions release. Any further change fails the token guard until explicitly reviewed or tokenized; Phase 2 stays disabled for SpecOps.
