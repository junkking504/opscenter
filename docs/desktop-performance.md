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
