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

The 176px page rail lists every primary page under Command, Control, Crew,
Convoy, Capital and Campaign. Capital and restricted Crew reports follow the
existing financial permission boundary. Every item is a real link (including
open-in-new-tab), retains the operating date and clears unrelated record filters.
The active page has `aria-current="page"`; keyboard focus is visible. The page
list scrolls independently so OpsBot, source checks and the user remain available
at the bottom. Mobile retains its workspace selector and shared page tabs.
The existing URL keys remain compatible with saved links.
