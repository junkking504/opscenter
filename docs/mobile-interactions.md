# Mobile web interactions

`MobileInteractions` adds optional touch shortcuts to OpsCenter's existing visible
controls. It is a web interaction layer, not a native iOS control set. Guidance:
[Apple gestures](https://developer.apple.com/design/human-interface-guidelines/gestures/)
and [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/).
The workspace selector, metric preview button, refresh button, and close buttons
remain usable without gestures. Controls retain visible focus, native dialog
focus containment/return, status announcements and reduced-motion compatibility.

At widths up to 900 CSS pixels, deliberate horizontal single-finger swipes on
open page space move through all seven main workspaces, including Settings,
in the supplied permission-filtered sidebar order.
They never wrap. Navigation commits on release after 56px, or a deliberate 32px
fast flick (at least 0.5px/ms over 40–250ms), with horizontal travel at least
1.8 times vertical travel. A destination hint appears after 20px of horizontal
intent and warms only the destination code chunk before release. It never reads
operational data. Cancellation or returning toward the starting point removes
the hint. On an accepted release, the hint acknowledges the destination while
React renders it as a transition, then clears when that workspace commits.
The repeat guard is 220ms; the maximum gesture duration remains 900ms.
The outer 28px screen edges, forms, links/buttons, text selection,
horizontal scroll areas, maps/charts, audio/video players, embedded content,
slider/scrollbar/resize controls, draggable elements and explicit
`data-gesture-ignore` regions are excluded. Vertical intent, multiple touches,
cancellation, active dialogs/drawers, busy edits and repeated navigation cancel
or block a shortcut. The page has no global touch-action override or scroll
prevention. App-wide dirty state must be supplied through `busy`.

Vertical-only scrolling lists no longer disable horizontal navigation for the
whole list. A vertical movement or any native scroll still cancels a swipe;
horizontal tables, timelines and carousels retain their own gesture. The shared
content listener covers every workspace subpage, not just the opening views.
Source Health and other dialogs intentionally block background navigation.
The Huddle full-screen display and separate Waypoint/legacy office routes are
not part of the seven-workspace swipe sequence.

Committed workspace and header-tab changes receive a 240ms directional settle:
18px of horizontal travel and 94–100% opacity, with no delay before navigation,
hidden frame, cloned records or component remount. The header and pinned search
do not move. Reverse navigation uses the opposite direction; interrupted motion
is cancelled before a new interaction. Reduced Motion disables animation and
also cancels one already running. Existing URL replacement and swipe focus
return are unchanged. Superseding a pending swipe clears its hint and lock.

Refresh still requires a 96px downward pull within 900ms. Sheet dismissal uses
a full-width grab control at widths up to 900 CSS pixels (including tablets only
when within that breakpoint): 64px down within 1500ms, with horizontal/vertical
intent, cancellation and multitouch guards. Content scrolling outside that control
never dismisses a sheet. A visible tap/keyboard close alternative remains. Metric
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

## Appointment summary

On phone layouts, tapping a schedule appointment opens a compact read-only
summary from the current snapshot. History and follow-up appointment selection
also opens this summary at phone widths; wider layouts retain direct drawer opening. It retains source status, assignment/address warnings,
payment uncertainty and full notes behind a disclosure. It does not mount
closeout, editing, customer history or payment-preparation components.

Full details is an explicit second action; Back to summary preserves access to
the existing drawer. Operational actions retain their existing behavior. Phone appointment links
from other pages resolve to the same record in the summary first; desktop
record deep links retain their existing drawer behavior. Busy edits block dismissal and back navigation. The
actual originating appointment control is retained for focus return, including
Safari touch activation that does not focus a button automatically. Closing a
linked summary clears its record-opening URL parameters. A record removed from
the current snapshot closes its summary and does not reopen if it later returns.
