# SpecOps storm planning

SpecOps is a manager/admin workspace in the existing authenticated `/desktop`
app, linked at `/desktop?workspace=SpecOps`. Control, Crew and Convoy shortcuts
remain inside the existing shell. Its model comes from the user-supplied
[Gulf Coast artifact](https://claude.ai/artifact/B8QvgHy3z5VtEvRzuzoXTq), captured
October 9, 2026. It preserves landfall controls, wind swaths, candidate store
ledger, prospect research, costs, cash exposure and readiness questions.

## Authority and boundaries

This is a **planning model**, not a weather warning, live outage feed, confirmed
contract roster, dispatch instruction, revenue record or payment. The original
unverified current-storm claim was removed and its preset renamed Gulf Coast
example. Imported research and approximate coordinates retain explicit caveats.
Incomplete street addresses are excluded from pins and estimates; they remain
visible under Every store with unknown values, not a fabricated zero outage.
Before dispatch, verify exact premises, operating banner, contract coverage,
authorization, actual outage and disposal acceptance. Model probabilities are
assumptions and do not change from regional customer counts.

No application records or provider credentials enter the model. The authored
HTML is bundled locally; all Claude runtime/SDK code and external font requests
are removed. A sandboxed opaque-origin iframe allows scripts and explicit source
links, not same-origin access. Its CSP denies network requests and forms. Parent
messages are restricted to bounded height reports, validated numeric scenario
inputs and public storm observations. The blue observed storm center is distinct
from modeled landfall; applying observed intensity and motion changes only those
scenario inputs and never moves the planned landfall. Observations do not alter
store probabilities automatically. Session storage retains the scenario in the current browser tab across
workspace navigation and reload; Reset scenario restores the supplied defaults.
It is not a shared operational record. Zero truck capacity is unavailable, never
zero days to complete. No metered service, background job or dependency is added.

## Published observations

The user-selected [Southeast source page](https://poweroutage.us/area/regions/south%20east)
and official NHC position update supply explicitly timestamped public observations.
The authenticated manager/admin GET `/api/desktop/specops` reads only the runtime
`data/specops/conditions.json`; it makes no external requests. The desktop rereads
that local snapshot once per minute. Runtime data stays outside Git and releases.
The validated snapshot is published atomically using
`npx tsx scripts/publish-specops-conditions.ts <reviewed-json-file>` with the
existing `OPSBOT_DATA_DIR`. The publisher does not fetch or scrape any site.

Schema 1 contains independently nullable `outage` and `storm` observations. Outage
records carry check time, source-reported age at check, source URL, total customers
out/tracked and exactly five unique state totals, which must reconcile. Storm
records carry check time, actual NHC observation time, source URL, name, center
coordinates, sustained wind mph, movement degrees/mph and pressure mb. Invalid
records are unavailable, never silently converted to zero. Future timestamps,
unsafe source links, malformed files and invalid values fail closed. Publication
refuses to erase or roll back a newer observation.

Outages are stale after 30 minutes including the source age at check. Storm
observations are stale after 90 minutes from the actual NHC observation time;
rechecking an unchanged advisory does not reset its age. Stale observations stay
visible with warnings and a dashed marker; applying stale storm inputs is disabled.
The source times and check times are shown in America/Chicago. Zero outage is a
valid observed value; unavailable is distinct. Southeast coverage is AL, FL, GA,
NC and SC, excluding LA and MS. Customer counts never confirm store-level outages.

The user's Codex heartbeat checks the retained source browser tabs every ten
minutes, reads the displayed current figures and NHC update, and publishes a
validated snapshot. It is an external browser-assisted refresh, not an API feed
or an OpsCenter background collector. If source access or validation fails, the
last verified snapshot remains and ages visibly. Closed source tabs pause the
refresh until the user resumes it. No subscription, credentials, metered service,
direct-page scraper or payment is created. A future provider API integration
requires its actual access specification and separate spending review.
