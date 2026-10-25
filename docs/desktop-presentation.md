# Desktop presentation

Dashboard leads with recorded revenue for the selected operating date, the existing
`dailyRevenueTarget()` goal, remaining revenue, and a 52-week (364-day) comparison
so weekdays match. A live partial day is explicitly compared with a completed day.
Only saved metrics are read; absent or stale evidence remains unavailable. The
headline follows the existing freshness rules and preserves drill-through.

Jobs, Labor, Dump + Fuel, Net and RPH remain neutral supporting tiles. RPH is
retained from the production layout. Revenue is recorded, not verified cash;
assumed disposal costs and material stale, incomplete or unavailable indicators remain visible. Source timestamps and technical explanations are available through Source details, metric accessible descriptions and existing drill-through views.
The historical operating-day controls, map and OpsBot remain available.

Comparison chips sit at the top right; phone Dashboard cards place them in the heading row. Daily KPIs compare the same
weekday last week; Krewe compares the previous weekday, pay period or equally
elapsed month. Capital uses its existing matched-period financial comparisons.
Tooltips identify the period. Green means favorable (lower for costs), red means
unfavorable. Actual zero change is neutral; absent, non-finite and zero prior
baselines produce no chip. A partial live day is not a completed-day result.

Workspace page tabs use `WorkspaceTabs`: grouped bordered buttons with an explicit
selected state, optional counts, roving keyboard focus, Arrow Left/Right and
Home/End. Page titles use the 24px role; the Dashboard revenue headline uses 30px. Primary cards share one radius, border and shadow. Brand red is the
accent; semantic success and failure colors remain reserved for status.

`MetricValue` presents missing, unknown or stale KPI values as a muted normal-size
dash. Its tooltip and accessible label retain the reason; source notes and
refresh errors remain visible. Normal views omit redundant introductions and repeated provenance; disclosures retain useful diagnostic detail. Financial reading, source aging and calculation rules are unchanged. Real zeroes keep their numeric presentation.

## Navigation

The desktop sidebar stays 224px wide. Each workspace has a direct main-page
link and a separate disclosure arrow for its inline page list. Lists open and
close immediately, without width or height animation; the workspace content
keeps the same width and horizontal position. Expanding a list moves only the
following navigation rows, as in the selected fixed-width groups preview.
There is no flyout, backdrop, global width toggle or overlay dismissal behavior.
The active workspace opens its group when navigation changes workspaces; users
can close that group independently. Leaving a workspace keeps its list open;
only its arrow closes it. Selecting a page keeps its group visible.
Group disclosure does not use browser storage. Navigation scrolls within the
sidebar on short screens, keeping Settings and Sources in the footer. Mobile
retains the existing workspace selector.

Page links preserve the operating date, clear unrelated record filters, support
keyboard and modifier clicks, and reuse the existing workspace preload. Finance
and The Huddle retain financial access checks. Busy mutations block both workspace
and page navigation. The Huddle retains its full-screen route and current-day
behavior. Actions, Call-in plan, Reconciliation, Driving, Records & invoices and standalone
Trends stay omitted from the sidebar; Monitor and Call-in plan remain available
in their workspace header tabs. Existing saved links remain compatible.

For synthetic sidebar QA, run `node desktop-ui/node_modules/vite/bin/vite.js
--config desktop-ui/tests/sidebar.vite.config.ts` from the repository root, then
`DESKTOP_TEST_ORIGIN=http://127.0.0.1:3167 node scripts/test-desktop-rail-browser.mjs`.
The server uses strict port binding so it never replaces another task's server.

Settings initially provides My Preferences, Notifications, and Connections.
The default opening workspace is stored in versioned browser local storage,
shared by users of that browser, and applies only to the bare desktop URL.
The Settings page omits daily operating controls but retains the selected date when returning to workspaces. Explicit page/date links take precedence and Finance preferences are ignored
without financial access. Storage failures are reported rather than shown as saved.
Existing manager notification controls live here; opening Settings does not send
a test, request notification permission, approve a device, or enable delivery.
Connections reuses the existing source health observations and freshness labels.
No collector, provider connection, or new polling is introduced.

Actions, Call-in plan and Reconciliation are omitted from the sidebar.
Convoy Driving and Records & invoices are omitted from the sidebar and page tabs.
Capital Trends is included below the Overview summary; its separate sidebar
entry and page tab are omitted. Saved Trends links and existing metric actions
open Overview at its trends section. Their existing
views and URL keys remain compatible with saved links.

Control Board's truck strip uses the existing schedule and GPS snapshot. Completed
job charges exclude tips and estimates; incomplete charges show a dash. Each job
uses the same unique displayed truck as the board, avoiding revenue duplication
across GPS visit lanes. Fresh GPS supports parked/on-route status; historical
open work says Planned and absent GPS remains unavailable. “Off today” means no
active scheduled appointments, not verified attendance. Cards select the truck
on the existing map; map resizing, timeline and assignment tools remain intact.

Command updates are compact native disclosure rows: time, type, truck, customer,
and follow-up flag. Enter/Space expands the original detail block, including its
source facts, photos, record link and existing workflow actions. Filters and
newest-first ordering are unchanged; no detail is discarded to compact the feed.

## Capital revenue pace

MTD/YTD/Custom displays daily bars and two cumulative series against the same
calendar dates last year. Today alone gets a brand-red bar; last year is dashed.
The chart reuses the existing saved prediction dataset's actual revenue and the
fresh selected-day finance value. It never uses forecast values as actuals.
Daily bars use the left axis, cumulative lines the right. Missing days break the
cumulative series rather than inventing zero revenue. Leap-day comparisons are
unavailable where no matching date exists. Custom ranges are bounded to 366 days.
Published monthly totals can have separate authority; the chart states its
source and exposes a dated data table.

## Update ready

The desktop checks `x-opscenter-release` using a same-origin HEAD request to its
existing wordmark asset every 60 seconds while visible, and on return/online.
The first valid SHA is the session baseline. A different SHA displays a polite,
non-blocking Update ready toast. **Later** dismisses that SHA for the session;
a later distinct release can prompt again. **Refresh now** is the only reload
path and is disabled during an active action/review. Missing headers, timeouts,
failed requests and offline state cause no reload or false update message.
No health aggregation, collectors, new endpoint or provider requests are added.
The release proxy supplies the header when enabled. Legacy origins also expose
the exact Git build SHA on the wordmark request with `release-check=1`, using
Next.js response headers and `no-store`. Ordinary wordmark requests retain their
existing caching. Builds without a valid Git identity omit the fallback header.

## Command average job size

Command > Alerts shows AJS beside RPH in the responsive metric grid. AJS reuses
Finance’s published daily gross revenue / completed jobs calculation, including
its field precedence and market totals. Closed estimates, schedule appointment
totals, and split employee credits are not the denominator or numerator. A zero
completed-job count or missing input displays unavailable; zero revenue with
positive completed jobs displays $0.00. The completed-job revenue freshness
contract governs both inputs, including retained-browser aging and historical
snapshots. Opening AJS shows the existing average-job Finance trend for the
selected date, with a note that the existing operating chart uses Truck Records
values and may differ from the gross-job card. The card also labels its gross
job-value basis. The three-column layout extends through 1240px so four-digit
amounts and negative Net values fit before switching to six columns. No new
source read or collection is introduced.

## Command on phones

At widths up to 760px, Command uses a compact opening overview: workspace
navigation, one date-control row, then search with icon buttons for OpsWiki and
alerts. The workspace heading remains accessible to screen readers; its visible
name is already present in the mobile selector. Revenue and remaining goal share
a row, with the complete source, comparison and basis text below. The six other
KPIs retain their values, descriptions, source timestamps and drilldown actions.
Comparison badges share the card heading instead of consuming a separate row.
No finance calculation, freshness rule, query or operational action changes.

The height regression uses the complete live header and realistic source text,
not an isolated grid. At 375–430px wide, the full KPI section fits a 740px content
viewport with a 34px bottom reserve (browser/status chrome is outside the content
viewport); 320px uses 800px. Shorter windows and enlarged text can scroll normally:
never clip content, hide a metric, scale the entire page, or trap scrolling to
force a fit. Physical handset acceptance remains separate from browser tests.

## Final workspace names

The display names are Dashboard, Command, Krewe, Fleet, Finance, and Marketing.
`desktop-ui/lib/workspace-labels.ts` owns the desktop mapping. Persisted keys and
bookmarks remain `Command`, `Schedule`, `Krewe`, `Fleet`, `Finance`, and `Marketing`,
respectively. The legacy navigation labels match these names. The Operating
Control area stays within Dashboard; it is distinct from the Command dispatch workspace.

Shared workspace controls and cards use `workspace-consistency.css`: brand red
for actions and selected filters, semantic status colors for evidence, and
content-sized financial cards so comparison chips cannot hide their labels.
Release notices wait until the current record review or edit closes. Failed
refreshes offer Retry and distinguish retained data from an initial load failure.

## CI token consistency — October 23, 2026

Newer Customer, Fleet, Campaign, Huddle, Settings and appointment styles use the
shared color and type tokens. Component-specific colors retain their existing
values in `design-tokens.css`; the Huddle spotlight headings use the existing
36px type anchor instead of off-scale 38px/34px sizes. Command mobile metric
and revenue labels use tokenized clamp endpoints. These type and color tokens
follow the existing phase-two workspace remaps; in Command the metric lower
bound becomes 20px, affecting viewports narrower than about 364px. The
token check explicitly covers both clamps and rejects raw or undefined sizes.

## Shared visual hierarchy

Dashboard cards use four purposeful roles: compact 11px labels/source summaries,
16px controls, 24px KPI values and the 30px revenue headline. Other workspaces use
12px captions for roomier records and tables. Regular and semibold are the main
weights; labels use sentence case. Values align at the top, use tabular numerals,
and keep original calculations, warnings, freshness descriptions and drilldowns.
Unusually long formatted values use the control-size role without truncation.
Phone Dashboard tabs remain in one compact row; Command tabs use an intentional
three-column group and separate full-width appointment search. Other workspace
navigation groups adapt to their tab count. Focus remains visibly outlined.

Forecast charts keep straight daily actual lines, a dashed forecast, the historical
20–80% spread, a visible forecast boundary and low-confidence warning. The spread
is not presented as a prediction interval. A day selector exposes exact actual,
forecast and range values on touch and keyboard; a missing observation is distinct
from zero. Source/method explanations remain available in disclosures. No smoothing,
forecast-model change or additional data request is introduced by presentation.

Fleet inspections use attention-first cards with truck identity and separate
service, inspection and repair labels. Missing inspections remain missing. The
status totals use existing local filters, and details retain all findings/actions.
Marketing lead cards put the recorded customer name first; outcome and contact-record
presence remain separate facts. Existing qualification and appointment matching rules
are unchanged. Full notes remain in the detail panel.

Finance, Krewe, Settings, Source Health and office support/account/manager pages
use scoped presentation styles. Their operational controls, permissions, semantic
warnings and source selection remain unchanged. Separate Waypoint/crew phone apps
are outside this presentation scope. Local synthetic desktop and phone-width
browser evidence does not establish acceptance on a physical handset.
