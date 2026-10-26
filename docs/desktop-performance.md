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
