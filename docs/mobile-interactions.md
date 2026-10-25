# Mobile web interactions

`MobileInteractions` adds optional touch shortcuts to OpsCenter's existing visible
controls. It is a web interaction layer, not a native iOS control set. Guidance:
[Apple gestures](https://developer.apple.com/design/human-interface-guidelines/gestures/)
and [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/).
The workspace selector, metric preview button, refresh button, and close buttons
remain usable without gestures. Controls retain visible focus, native dialog
focus containment/return, status announcements and reduced-motion compatibility.

At widths up to 900 CSS pixels, deliberate horizontal single-finger swipes on
open page space move through the supplied permission-filtered sidebar order.
They never wrap. Navigation commits on release after 56px, or a deliberate 32px
fast flick (at least 0.5px/ms over 40–250ms), with horizontal travel at least
1.8 times vertical travel. A destination hint appears after 20px of horizontal
intent and warms only the destination code chunk before release. It never reads
operational data. Cancellation or returning toward the starting point removes
the hint. On an accepted release, the hint acknowledges the destination while
React renders it as a transition, then clears when that workspace commits.
The repeat guard is 220ms; the maximum gesture duration remains 900ms.
The outer 28px screen edges, forms, links/buttons, text selection,
nested scroll areas, maps/charts, videos, draggable elements and explicit
`data-gesture-ignore` regions are excluded. Vertical intent, multiple touches,
cancellation, active dialogs/drawers, busy edits and repeated navigation cancel
or block a shortcut. The page has no global touch-action override or scroll
prevention. App-wide dirty state must be supplied through `busy`.

Refresh and dismissal still require a 96px downward pull within 900ms; metric
holds remain 550ms with 12px movement tolerance.

Only explicitly annotated `data-gesture-preview` metrics have hold previews.
Their values and descriptions come from the existing display snapshot. A hold
never performs the metric's click action. The explicit Preview metrics button is
the accessible alternative. The preview and alert detail sheet can close with a
downward gesture on their labeled close control; their scrollable body is excluded.

Pull-to-refresh begins on the labeled Refresh data control. Restricting the pull
to this control preserves normal page/nested scrolling and browser pull behavior.
Its `touch-action: pan-x pinch-zoom` permits zoom; no page-level gesture override
is installed. `onRefresh` must only read current display snapshots, never source
collection, receipt verification, payments or operational recovery. The callback
is single-flight. This layer adds no timers for polling or provider calls.

Command's schedule refresh uses `displayOnly=1`. That server mode retains auth,
date validation and recovery warnings, but suppresses source-day requests,
background assignment checks/source-note writes and pickup receipt updates.
Ordinary schedule requests keep their existing behavior. The client preserves
any existing source-request status while replacing displayed snapshot data.

Validation: `node --import tsx scripts/test-mobile-gestures.ts`,
`node --import tsx scripts/test-display-only-refresh.ts`, and
`node scripts/test-mobile-gestures-browser.mjs` (synthetic Vite fixture on port
3192; override `GESTURE_FIXTURE_URL` when needed). Browser tests exercise actual
CDP touch navigation/pull/dismiss and synthetic cancellation/exclusion cases.
Chart reader integration is covered by
`node scripts/test-chart-refresh-browser.mjs` in Chromium and WebKit, including
zero/missing values, shared-flight reads, error retention and cancellation.
No private records or operational services are required. Physical handset
acceptance is separate from these browser checks.

Refresh coverage: registered Dashboard, Command board, Crew, Fleet, Finance and
Marketing lead snapshots use bounded local reads. Forecast, metric-detail, Fleet
report and Marketing charts register the existing local analytics snapshot reader
with the same refresh control. Their explicit Refresh charts buttons remain.
Concurrent reads are joined; date/scope changes and unmount abort obsolete reads.
A failed read keeps the previous charts with a visible warning. Missing chart data
remains unavailable, not zero. This never rebuilds predictions or calls a provider.
Command Calendar and History also keep their existing controls; the new refresh
shortcut is limited to Board, whose displayed snapshot has a read-only endpoint.
