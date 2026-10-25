# Office appearance preferences

OpsCenter supports Light, Dark and System appearance in the header and Settings.
The preference is local to this browser (`opscenter.theme.v1`), shared by its
signed-in users, and contains only `light`, `dark` or `system`. It does not change
account permissions, notifications, operating records or any external service.
System is the default and follows `prefers-color-scheme`; explicit choices take
precedence. Cross-tab storage changes are reflected without a reload. If storage
is unavailable, the choice applies for the visit and the control reports that it
could not persist it.

`lib/ops-theme.ts` is the single synchronous bootstrap used in the Next root head
and the Vite HTML transform. It resolves the preference before paint. The Next
html element acknowledges that deliberate pre-hydration attribute update; the
control subscribes through `useSyncExternalStore` with a stable server snapshot.
`components/ThemeControl.tsx` supplies a labeled native select. `styles/ops-theme.css`
and `desktop-ui/theme.css` apply the palette through existing semantic tokens;
new dark colors are registered in `desktop-ui/design-tokens.css`. Logos, photos,
map tiles, numeric values, chart paths and uncertainty are unchanged. Appearance
changes do not add transitions or override reduced-motion preferences.

The separate Waypoint/crew/payroll/inspection routes and Waypoint, Kingpin, Jobs,
Crew and Convoy hosts are excluded from the bootstrap. Root dark styling is
scoped to office shells and the explicitly identified OpsCenter login panel.

Validation: `node --import tsx scripts/test-ops-theme.ts` exercises preference
precedence, persistence, storage failure, cross-tab updates and excluded apps.
The existing desktop token check remains required. Visual acceptance covers
both themes and System behavior at desktop and mobile viewport sizes; local
browser evidence does not imply physical handset acceptance.
