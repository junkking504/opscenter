# Desktop color and type tokens — Phase 1

The desktop CSS entry loads `desktop-ui/design-tokens.css` first. Semantic
canvas, raised/muted surfaces, border, primary/muted text, brand and four status
ink/tint/accent sets follow the approved workbench vocabulary. Existing visual
variants retain role/family tokens until a separately approved Phase 2. Brand
identity remains in the shared `styles/brand-tokens.css` contract.

The user explicitly approved the three half-pixel rounding changes and CIELAB
Delta E < 2 merges on October 9. No broader neutral-family migration is included.

## Mapping and audit

The supplied `tmp/css_audit_20261009.py` was run before and after. Its strict,
frequency-first greedy method selects the nearest existing representative, never
transitive union-find chains. All 1,554 source colors and counts are recorded in
`scripts/fixtures/css-phase-one.json`; the architecture check independently
verifies every final representative has CIE76/D65 distance below 2 (maximum
1.999617). Core workbench semantics name those bounded representatives, so a
few source workbench colors also undergo the approved near-color merge.

| Supplied audit measure | Before | After |
| --- | ---: | ---: |
| CSS files in its two-folder scope | 61 | 62 (token file added) |
| Distinct opaque hex colors | 1,554 | 594 |
| Opaque hex literal occurrences | 3,726 | 594 (token definitions only) |
| Colors used once as literals | 985 | 594 (central definitions) |
| Further Delta E < 2 reductions | 960 | 0 |
| Font-size declarations | 2,033 | 2,033 |
| Literal pixel sizes in font-size | 30 | 0 (27 token sizes) |
| Font-size `!important` | 27 | 16 |

The supplied audit does not count alpha hex colors or follow variables. All 25
long-alpha colors and five short-alpha colors are centralized unchanged. Its
post-migration “0 under 10px of 0 px declarations” is a syntax count, not a
legibility improvement. The original 738 of 1,997 plain-pixel declarations under
10px remain under 10px; their values are now references. The 11 half-pixel
occurrences round 6.5→7 (5), 8.5→9 (5), and 11.5→12 (1). Integer sizes, relative
sizing, zero-size icon treatment and the two existing fluid clamps stay intact.
Shorthand font sizes also use the scale; line-height is untouched.

Eleven unnecessary importance flags in search results, drawer status, Convoy
service rows and Capital headings were replaced with component specificity.
Sixteen remain for existing JK/phone link inheritance and competing component
button/density cascades; removal without broader cascade work is not certified.
The architecture check caps their count at 16.

## Verification and scope

`npm run verify:css-architecture` rejects raw hex outside the token file (exact
file/value exception map currently empty), undefined tokens and off-scale font
sizes, including shorthand sizes. Negative tests cover new hex, half pixels,
rem sizes and nonexistent type tokens. The existing shared-app CSS budget stays
18,000 lines; current usage stays 17,680. This migration covers the supplied
61-file desktop audit, not third-party CSS, inline component colors or the
separate phone closeout styles.

For deterministic visual comparison, start the existing fixture server on
port 3158 using `desktop-ui/tests/area-colors.vite.config.ts`, then run
`npm run verify:desktop-tokens:browser`. `CSS_CAPTURE_DIR` selects output;
`CSS_BASELINE_DIR` enables strict visible text, font and element-bound comparison.
The fixture supplies synthetic data and blocks outside network requests; it does
not read Slack, paid providers or live records. Six 1280×720 workspace captures
(Command, Control, Convoy, Capital, Crew, Campaign) passed with identical visible
font sizes and geometry; colors show only the requested bounded substitutions.
Maps use fixture tiles. This is not a claim of Claude's production review or
coverage of every dialog/responsive state. Claude's independent branch and
production screenshot comparison remains the external review step.
