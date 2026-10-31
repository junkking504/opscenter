# Desktop performance

How fast the desktop app (`/desktop`, built from `desktop-ui/`) loads, how to
measure it, and the budget that keeps it from growing back.

## What loads when

- The shell script and stylesheet load on every page. They hold Command and
  the workspace frame, so they are the cost of every cold open.
- Control (Schedule) with its Leaflet map, Crew, Convoy, Capital and Campaign
  load on demand. `lib/desktop-release.ts` adds a `modulepreload` hint for the
  workspace named in the URL, and opening Control directly starts its code
  alongside its first read (`desktop-ui/main.tsx`). Command's map shares
  Control's code and loads once Command's records are on screen; preloading it
  earlier delayed those records in measurement.
- Charts (Recharts) load only on the views that draw them, through
  `desktop-ui/deferred-live-analytics.tsx`.
- Hovering or focusing a rail link preloads that workspace's code, and the
  shell warms other workspaces' records a second after Command is ready.

Stylesheets for on-demand Schedule code stay in the shell stylesheet, listed
in import order in `desktop-ui/live-schedule-styles.ts`. Loading them later
would change the cascade order depending on which page opened first. When a
Schedule module gains a stylesheet, add it there.


Route-exclusive normal rules for Krewe, Fleet, Marketing and Finance are in
`desktop-ui/{krewe,fleet,marketing,finance}-base.css`, imported before each
workspace's existing styles. Mixed selectors, functional selectors and
`!important` declarations remain in the shell. The extraction changes neither
declarations nor their order within each family. The repository-relative
`desktop-ui/css-extraction-manifest.json` records hashes and original rule
positions; `scripts/test-css-extraction.mjs` reconstructs the original rule
sequence and runs with `npm run verify:css-architecture`. Future changes to
these audited packets must update the manifest with a fresh cascade comparison,
not simply remove the check. Compare cold entry and warmed styles in both
navigation orders, light/dark themes and phone/desktop layouts.

Settings, Agent Hierarchy, Maintenance Monitor, Photo Review and Truck Agents
use `desktop-ui/deferred-secondary-workspaces.tsx`. Their existing conditional
rendering loads the component and its scoped CSS together; the Vite dynamic
import waits for its CSS dependencies before rendering. Suspense supplies a
visible loading status. Truck recommendations in Fleet wait until truck details
are opened. This does not add reads, background jobs or polling. Existing
reference-only mode waits for `reference-workspace-styles.ts` before rendering,
so it retains the same four base packets without adding them to live cold opens.

Appointment drawer `ScheduleControls` loads only when the drawer opens, through
`deferred-schedule-controls.tsx`. Its existing Astryx controls, theme and scoped
CSS load together before rendering; a local loading status keeps the rest of the
drawer available. Shared receipt helpers are imported directly from
`schedule-receipt.tsx`, so classification and rescheduling do not eagerly import
the controls. The board retains its stable shell CSS order; only the separately
layered Astryx packet travels with the deferred controls.

Fleet's collapsed help guide loads its content on first expansion and keeps it
mounted for later openings. Existing navigation and all guidance remain intact.
Tailwind excludes synthetic `desktop-ui/tests` fixtures from utility discovery;
production component discovery is unchanged. Settings-only presentation rules
load after its existing deferred base stylesheet; Source Health rules stay in the
shell. Their selectors and declarations are unchanged. No download budgets are
raised. Isolated Finance chart/detail control rules also travel with Finance
(and the reference-only style entry); rules that depend on shell cascade order
remain eager.

Check cold imports and preserved control behavior with
`scripts/test-deferred-controls-browser.mjs` against the synthetic dispatch
fixture described in [Astryx adoption](astryx-components.md), plus the existing
Astryx and schedule browser suites.

## Budget

`npm run verify:desktop-bundle-budget` (after `npm run build:desktop`) fails
when the shell or a workspace grows past its gzip budget in
`scripts/test-desktop-bundle-budget.mjs`, or when Schedule ships its own
stylesheet. Raise a budget only with a reason in the commit; lower it after a
win so the gain is kept.

## Measuring

`npm run perf:desktop` opens the desktop in headless Chromium with a throttled
connection and CPU, and reports cold loads per workspace (document, first
paint, records visible, long tasks, bytes) and warm navigation from Command.
It needs a running server and a session cookie for it:

```sh
OPS_PERF_BASE_URL=http://127.0.0.1:3000 OPS_PERF_COOKIE='opscenter_email_session=…' \
  npm run perf:desktop -- --json perf.json
```

Use a local or preview server. Against empty data the numbers isolate code
cost; against real data they include the API reads. Nothing is uploaded.
For a single browser, `?performance=1` on `/desktop` shows the in-page timing
panel from `desktop-ui/navigation-performance.tsx`.

## Server reads

One Command request used to replay the same day's LinxUp GPS evidence five
times (Command, dump expenses, truck loads and visit tracking each call
`readGeofenceEntries`) and re-parse the whole appointment geocode cache for
every GPS stop on the map. Both now go through `lib/source-file-memo.ts`,
which reuses a reading while every source file keeps its modification time and
size, for at most a few seconds (GPS) or a minute (geocodes). A collector write
is picked up on the next call. Values from the memo are shared, so callers must
not mutate them.

Command's comparison with the same weekday last week only needs that day's
schedule counts, so it uses `summarizeCommandScheduleFromMetrics` instead of
building a second map with geocodes and GPS (`lib/desktop-command.ts`).

Campaign (`readDesktopMarketing`) shows every SearchKings inquiry ever and
every Podium review. It used to rebuild each month's appointment roster from
daily metrics, parse every daily copy of the Podium review history to find
yesterday's, and reread every day's appointments for review suggestions on
each load. Now:

- SearchKings snapshots and each month's appointment roster go through
  `sourceFileMemo` (`lib/searchkings.ts`), keyed on the snapshot file and the
  month's daily metrics files. Lead status is still computed on every load,
  because it depends on the current time.
- The previous Podium snapshot is found newest first by the Chicago date in
  each history file's name, which the collector writes, so only the last day
  or two are parsed (`readPreviousPodiumGoogleReviewsSnapshot`).
- Review-suggestion appointments are reused until a file in `processed/`
  changes (`lib/podium-review-attribution.ts`).

`scripts/test-campaign-read-performance.ts` (part of
`npm run verify:podium-reviews`) checks that these reads stay bounded and that
a collector rewrite shows on the next load.

## Switching operating days

The shared date bar now changes browser history and the selected day inside the
running app. Its date-keyed workspace subtree resets appointment selections and
view-local drafts; the authenticated in-memory read cache survives. Back/forward
restores the selected day. Date changes remain blocked while a mutation is pending.
The cache is bounded to 48 responses and five minutes, cleared on writes and
401/403 responses, and never persisted to browser storage. Aborted readers cannot
publish into a different date; shared reads may still finish for their own key.

Dashboard first requests `/api/desktop/command?date=…&part=summary`. This reads
saved financial and schedule evidence without Slack, workflow database access,
map construction, or the estimate scan. It publishes the revenue/KPI cards before
requesting the complete operational feed. Map and truck-assessment components
retain independent reads. A slow or unavailable update feed leaves those figures
visible; initial alert counts stay unknown until history arrives. A cached same-day
feed keeps its original verification timestamp while financial evidence refreshes.
Summary and full reads use the same KPI calculation and source-freshness rules.

Slack history remains shared per date with no overlapping reads. Historical days
reuse a settled digest for up to five minutes; current/future dates retain the
30-second lifetime. The displayed Slack source timestamp remains the actual fetch
time. Refresh displayed data passes `refresh=1` to bypass a settled digest (but
shares one already in flight); provider cooldowns still apply. Local corrections
are read on each existing Dashboard refresh. No new collectors or provider polling
are introduced.

`verify:command-loading`, `verify:command-arrivals`, `verify:command-schedule-summary`,
and `scripts/test-workspace-navigation.ts` cover date isolation, original freshness,
write/auth invalidation, late reads, bounded cache lifetime and remote deduplication.
`desktop-ui/tests/instant-day-loading.html` is a synthetic browser fixture with
120ms summary reads and 3–7 second history reads; `fail=1` makes history fail while
figures remain available. It records click-to-figures timing in the visible footer.
Use its dedicated Vite config on localhost port 3178. It never writes business data.
