# Desktop presentation

Dashboard leads with recorded revenue for the selected operating date, the existing
`dailyRevenueTarget()` goal, remaining revenue, and a 52-week (364-day) comparison
so weekdays match. A live partial day is explicitly compared with a completed day.
Only saved metrics are read; absent or stale evidence remains unavailable. The
headline follows the existing freshness rules and preserves drill-through.

Jobs, Labor, Dump + Fuel, Net and RPH remain neutral supporting tiles. RPH is
retained from the production layout. Revenue is recorded, not verified cash;
assumed disposal costs and all source/freshness explanations remain visible.
The historical operating-day controls, map and OpsBot remain available.

Comparison chips sit at the top right; phone Dashboard cards place them in the heading row. Daily KPIs compare the same
weekday last week; Krewe compares the previous weekday, pay period or equally
elapsed month. Capital uses its existing matched-period financial comparisons.
Tooltips identify the period. Green means favorable (lower for costs), red means
unfavorable. Actual zero change is neutral; absent, non-finite and zero prior
baselines produce no chip. A partial live day is not a completed-day result.

Workspace page tabs use `WorkspaceTabs`: one underline style, optional counts,
roving keyboard focus, Arrow Left/Right and Home/End. Page titles use the same
26px token. Primary cards share one radius, border and shadow. Brand red is the
accent; semantic success and failure colors remain reserved for status.

`MetricValue` presents missing, unknown or stale KPI values as a muted normal-size
dash. Its tooltip and accessible label retain the reason; source notes and
refresh errors remain visible. Real zeroes keep their numeric presentation.

## Navigation

The desktop sidebar opens expanded at 240px with an 80px compact rail available
through the labeled header toggle. This browser remembers its collapsed state;
blocked storage still permits the toggle for the current session. Workspace
labels open their main page in one click. Separate chevrons show inline page
links without navigation; selecting a page switches the existing workspace view
immediately. The active workspace's pages open when the workspace changes.
Settings and Sources remain in the footer. Short windows scroll the sidebar
without overlapping its footer. Mobile retains the existing workspace selector.

Page links preserve the operating date, clear unrelated record filters, support
keyboard and modifier clicks, and reuse the existing workspace preload. Finance
and The Huddle retain financial access checks. Busy mutations block both workspace
and page navigation. The Huddle retains its full-screen route and current-day
behavior. Monitor, Actions, Call-in plan, Reconciliation, Driving, Records & invoices
and standalone Trends stay omitted; existing saved links remain compatible.

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
