# Desktop presentation

Command leads with recorded revenue for the selected operating date, the existing
`dailyRevenueTarget()` goal, remaining revenue, and a 52-week (364-day) comparison
so weekdays match. A live partial day is explicitly compared with a completed day.
Only saved metrics are read; absent or stale evidence remains unavailable. The
headline follows the existing freshness rules and preserves drill-through.

Jobs, Labor, Dump + Fuel, Net and RPH remain neutral supporting tiles. RPH is
retained from the production layout. Revenue is recorded, not verified cash;
assumed disposal costs and all source/freshness explanations remain visible.
The historical operating-day controls, map and OpsBot remain available.

All comparison chips share the top-right position. Daily KPIs compare the same
weekday last week; Crew compares the previous weekday, pay period or equally
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

The 256px page rail lists the selected primary pages under Command, Control, Crew,
Convoy, Capital and Campaign. Capital and restricted Crew reports follow the
existing financial permission boundary. Every item is a real link (including
open-in-new-tab), retains the operating date and clears unrelated record filters.
The active page has `aria-current="page"`; keyboard focus is visible. The page
list uses compact spacing in laptop-height desktop windows so all pages fit
at the standard 990px content height without scrolling. It explicitly allows
flex shrinking and independent scrolling as a fallback for shorter windows,
so source checks remain available at the bottom. OpsBot opens from the
existing header search; its sidebar card and the static account card are omitted
to leave room for 32px navigation rows, 16px labels and 20px icons
in laptop-height windows. Mobile retains its workspace selector and shared page tabs.
Actions, Monitor, Call-in plan and Reconciliation are omitted from the sidebar.
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
