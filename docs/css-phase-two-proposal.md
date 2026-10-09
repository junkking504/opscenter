# CSS Phase 2 — proposed visible changes

**Proposal only; no product CSS changed.** Approve palette, neutral direction and
text-size decisions separately before implementation. The Phase 1 branch remains
bounded to the previously approved rounding and Delta E < 2 substitutions.

Open [the before/after swatches](css-phase-two-swatches.html). The searchable
page includes all candidate merges, five neutral examples, and the complete list
of 98 current 6–7px declarations. Machine-readable candidates are in
`css-phase-two-palette-candidates.json`.

## Palette consolidation

The original audit's 252 estimate clusters all 1,554 original colors directly
at Delta E < 5. After Phase 1, the 594 representatives have new aggregate usage
weights. Sorting those by aggregate original use (hex tie-break), and selecting
the nearest direct representative within Delta E < 5, produces **244 candidates**
and **350 merges**. Every candidate movement is between Delta E 2.0031 and 4.9803.
This explains the difference from ~252; 244 is a review candidate, not a target
that overrides meaning or contrast. The supplied unweighted post-token audit
produces 246 because every token definition appears once.

Keep status ink/tint/accent and territory/brand identities as distinct semantic
aliases even when their numeric palette values coincide. Review every proposed
foreground with the backgrounds on which it actually appears, plus hover,
selected, disabled and dark states. Reject a merge if it weakens meaning,
contrast or the distinction between two neighboring statuses. Alpha values and
shared brand identity are excluded from quantization. Do not use transitive
clusters: a sequence of small changes can move an endpoint far beyond Delta E 5.

Implement one workspace per commit, with the semantic alias contract stable.
First use high-frequency surface and border candidates, then review text/status
pairs, then the remaining accents. Keep rejected candidates documented rather
than inventing a less safe rule to reach a palette-count goal.

## Neutral family migration

This is a separate design change and can exceed Delta E 5. The swatch page shows
current Phase 1 representative examples beside the approved workbench direction:
canvas `#f1f6f8`, raised subtle surface `#f6f9fb`, border `#dbe4e9`, primary ink
`#243b4d`, muted ink `#687e8e`. Also retain pure white for raised cards and the
existing dark sidebar. Normalize the older green-gray surfaces/text by role,
not by replacing every green hue—green status, territory and completion cards
must remain recognizable. Move one semantic layer at a time and inspect all six
workspaces before accepting each layer. Resolve candidate merging and neutral
migration into one final map so a color is not inadvertently moved twice.

## Type scale and small-text decisions

Proposed base scale: **9 / 10 / 11 / 12 / 13 / 14 / 16 / 20 / 24 / 28 px**.
Keep an explicitly documented **8px compact-label exception**, because the
approved workbench deliberately uses 8–9px. Do not grant that exception to
customer names, addresses, monetary amounts, job identifiers, warnings, controls
or essential table values. A global “everything under 10 becomes 10” replacement
would break the dense schedule and erase useful hierarchy.

| Current role/value | Proposed treatment |
| --- | --- |
| All 6px and 7px text | Review every selector in the swatch inventory; use at least 9px, 10–12px when operational meaning matters, or remove truly redundant decorative text |
| 8px brand strapline/nonessential micro-label | Retain only as a named compact exception with redundant accessible meaning |
| 8px VIN, date/time, job/status detail | Usually 9–10px; reveal full content in readable detail, never make a tooltip the only access |
| 9px secondary labels/ticks | Keep when readable at 100% and 200% zoom and distinct from values; otherwise 10px |
| 10–14px | Preserve existing role hierarchy; avoid blanket rounding |
| 15 / 17px | Review toward 16px; 17px dense headings may need 16px plus spacing |
| 18 / 19 / 21px | Review toward 20px |
| 22 / 23 / 25px | Review toward 24px |
| 26 / 27px and larger display values | Review 28px; large KPI/hero exceptions require explicit approval rather than silently shrinking 42px |

The original **738** figure is under-10 plain-pixel declarations out of 1,997,
not unique visible elements. It excludes important declarations, shorthands and
relative sizes. Phase 1 left the small-text problem intact. The current complete
6–7px font-size inventory is **98 declarations: four 6px and 94 7px**, including
the five former 6.5px declarations. Some are obsolete/overridden selectors;
determine that from computed styles before removing them.

For all small-text rules, inventory selector → workspace/state → computed value
at 1280×720, 390px and 200% zoom. Classify as essential information, compact
secondary label, redundant decoration, or demonstrably unused. Record the
accepted size and overflow behavior; no unclassified 6–7px rule should remain.
For dense Control labels, first simplify duplicate text and reserve row height,
then enlarge the text. Maintain readable overflow rather than scaling the whole
schedule down. Keep touch targets independent from text size.

## Acceptance before deployment

Use fixed synthetic data for deterministic before/after captures and authenticated
production checks for actual content. Review Command, Control, Convoy, Capital,
Crew and Campaign, including dialogs, source warnings, selected/hover states,
long names and missing data. Require readable clipping/wrapping and stable action
access; compare color pairs and status recognition. Test keyboard and screen
reader labels for information removed from compact views. Preserve all routes,
source values, assignments and payments.

Update the existing token guard only after each new scale/exception is approved.
An exception must identify exact selector, reason and review evidence. Keep
before/after swatches and a small per-workspace decision record. Claude's visual
acceptance and T’Jean's approval are still pending; these files change no UI.
