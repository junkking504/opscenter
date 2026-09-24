# Background maintenance pilot

The separate `com.openclaw.opscenter.maintenance` LaunchAgent observes OpsCenter
once a minute. Command > Monitor shows current and cleared conditions, measured
evidence, AI suggestions, worker freshness, and monthly usage. Source Health
also reports missing/stale observer heartbeats. AI diagnoses remain advisory. Address research uses independently validated
source evidence as described below. A separate
fixed Python policy can start a confirmed stopped OpsCenter process. There is no
shell execution by AI, source-system repair, automatic deployment, or outbound message.

## OpsWiki troubleshooting

Managers and administrators see automatic local troubleshooting in Command >
Monitor. The latest observer evidence is matched with relevant past incidents,
fixes and prevention lessons, with dated source links, recurrence counts, next
checks and recovery requirements. See [OpsWiki](second-brain.md). Matching
adds no AI requests and does not execute repairs or close incidents. Missing or
stale evidence remains explicit. This is separate from the existing AI pilot
and bounded process recovery controls.

## Automatic process recovery

Command > Monitor includes an administrator-only enable/pause switch, worker
freshness, daily attempt count, and recent recovery receipts. Recovery defaults
off until explicitly enabled. The policy is persisted outside Git in the same
maintenance directory as `recovery-policy.json`; missing/corrupt policy is off.
Pausing blocks new attempts, but cannot undo a start command already issued.
When the app is unavailable, the local emergency off switch is an atomic update
of that file to `{"version":1,"enabled":false}`. Preserve the recovery ledger.

The existing OS-locked Python observer runs recovery before the AI tick, so
process recovery does not depend on the web server or the model. Launchd already
has KeepAlive; this fallback only addresses a persistent stopped process. Three
eligible checks at least 45 seconds apart are required; gaps over 150 seconds
reset confirmation. Only the loaded, explicitly enabled production label
`com.openclaw.opscenter`, registered with the production wrapper, is eligible.
A PID, occupied/uncertain port 3000, unknown service state, live wrapper lock,
known operational write lock or detached JunkWare writer blocks recovery.

Before action the worker acquires the controller's `.deploy-lock` using atomic
mkdir, then rechecks policy, active immutable release, and stopped evidence. A
deployment holding that lock blocks recovery. A recovery holding it makes a new
deployment fail safely and require a later retry. A crashed worker can leave the
deployment lock for manual review; neither worker nor controller removes another
owner's lock automatically.

The only command is `launchctl kickstart gui/<uid>/com.openclaw.opscenter`, without
`-k`. It cannot kill a running or naturally recovering server. It never bootstraps
an unloaded service or enables a deliberately disabled one. The worker durably
reserves one attempt per outage before invoking the command, with a 30-minute
cooldown and two attempts per Chicago calendar day. Timeouts, crashes, and failed
verification consume the attempt. Three healthy periodic process/login checks
are required before a later outage can receive a new attempt. Pausing or restarting
the observer does not reset limits.

Verification requires a running process and three consecutive local `/login`
HTTP 200 responses, sampled five seconds apart in at most five samples. This
verifies process/login recovery only. Source freshness, readiness, and actual
authenticated interactions retain their independent incident/verification paths.
An unverified start is recorded for manual review and is not automatically retried.

`recovery.json` and `recovery-initialized` preserve attempt history outside Git;
invalid or missing initialized state fails closed. `recovery-error.json` reports
fixed failure text without private command output. The latest 100 transitions
are retained; the UI shows the latest 10. Do not delete these files to reset limits.
The pilot does not automatically restart running unhealthy servers, collectors,
databases, or tunnels, modify business records, or deploy code changes.

## Coverage and limits

The worker reads local `/login`, `/api/health`, and `/api/readiness` independently
of the application's request lifecycle. It monitors daily metrics, JunkWare
schedule freshness, LinxUp freshness/fallback, storage and database health,
Crew Portal publication, and photo queues. Incoming/processing age is separate
from historical review/failed records. Human review is a separate condition,
not a service outage. Missing evidence cannot clear an existing incident.

Authenticated live desktop sessions submit only four fixed browser categories:
JavaScript runtime errors and failed Schedule, Command, or Control requests.
No URLs, query strings, stacks, messages, customer records, or request/response
bodies are submitted. Reports are throttled on the client and server. These
reports cover active browser sessions only; no reports do not verify a working
interaction. The pilot does not yet proactively drive authenticated browsers,
parse server logs, monitor every integration, or prepare code patches.

Two observations at least 45 seconds apart confirm an incident. Three clear
observations clear it. A repeated unresolved condition gets one AI assessment;
numeric count/age changes do not trigger repeated paid requests. A recurrence
after clearance starts a new assessment. Failed AI requests wait at least one
hour globally and stop after three attempts per incident. At most two calls run per tick.

## AI and budget

The worker reads the existing `OPENAI_API_KEY` assignment from
`~/.openclaw/workspace/opsbot/.env.ai` without sourcing the file, printing it,
or copying it. An inherited `OPENAI_API_KEY` takes precedence. GPT-5.6 Luna
receives fixed condition summaries and embedded recovery guidance through the
Responses API with `store: false`, a strict JSON schema, no tools, a bounded
input, 2,048 maximum output tokens and a 25 second request timeout. AI text is
shown as a suggestion, never verified cause or completed repair.

The worker enforces a $10 calendar-month budget in America/Chicago, independent
of any provider dashboard alerts. It durably reserves $0.02 before each diagnosis call.
That exceeds the bounded request cost at the pinned standard prices of $0.20
per million input tokens and $1.20 per million output tokens (including reasoning).
Validated usage settles the reservation; uncertain usage keeps the full charge
against the cap. The UI separates estimated actual cost from committed budget.
Pricing changes require review. Unexpected usage pauses AI. The budget covers
only this worker, not other applications sharing the API key.

State and its budget ledger live outside Git at
`~/.openclaw/workspace/opsbot/data/integrations/opscenter-maintenance/state.json`.
A single OS file lock covers the entire worker invocation, including child
execution. Writes use fsync and atomic rename; a corrupt ledger fails closed.
Do not delete the ledger as a recovery method: doing so discards spending history.
The most recent 200 transition/request receipts are retained. Browser counters
contain fixed categories, timestamps and bounded counts only.

## Automatic address investigation

Policy 11 recognizes Loop/Lp streets, removes only adjacent literal repetitions
of the same complete street in flattened source cells, and accepts Louisiana
addresses without a separate state field in the supported parish localities.
The parish dataset's `ADDRESS_AUTHORITY` is the assigning jurisdiction: records
from Parish, Baton Rouge, Saint George, Baker, Central and Zachary pass the same
exact house/street/locality/ZIP and unique-point checks. A municipal authority is
not a failed provider response. Old negative caches and sweep backoff are retried
when the verification policy changes.

Address links open Google Maps searches; they do not send Google's result back
to OpsCenter. A browser-reviewed exact building result can be recorded in
the existing durable review cache with its source URL and reviewing actor.
That record is reused by Schedule and the background visit cache. Automated
Google geocoding remains retired; these parser/provider fixes use existing free
lookups and do not change paid research limits.

Schedule normalizes flattened JunkWare address cells before territory matching,
verified-cache lookup and research discovery. An action-only suffix (`Followup`,
`SMS`, `More Details` and labeled follow-up variants) after a complete ZIP is
removed by the shared `cleanJunkwareAddressText` parser. Business names, units,
house/street/locality/ZIP and unknown trailing text remain intact. Raw source
snapshots are preserved. Direct verification and cache consumers apply the same
rule, so existing evidence survives source action-label changes. Verification
policy 6 immediately reconsiders prior negative results under the existing
bounded refresh cadence. The minute runner drains queued GPS first, then checks
addresses even if that drain failed, before connectivity probes and LinxUp
requests. GPS transport or certificate failures cannot suppress address recovery. A failed address check retains prior
evidence and still permits GPS processing. Fault-injection tests exercise both
failure paths. `verify:service-addresses`, also required by the build,
covers source sweeps, geography, research identity, verified-cache reuse,
provider queries, and rejection of conflicting premises.

The same OS-locked observer scans active appointments in collected upcoming
Schedule days. It keeps a durable queue in `state.json.addressResearch`, deduplicated
by full premises address across dates and suite variants. Formatting-only retries
use the existing geocoder first. One address step runs per tick; research and
AI diagnosis do not run together in the same tick.

With the separate spending approval, an unresolved address gets one Luna research
request with one web search. The full 10-cent lifetime allowance is reserved in
the existing $10 monthly ledger before sending. A crash, timeout or quota failure
consumes that attempt and retains uncertain cost; another appointment or month
cannot reset it. Provider failures apply the existing one-hour shared cooldown.
The initialization marker prevents silently recreating a missing research ledger.
Never delete queue history or markers to retry paid work.

The model receives only the service address, not the customer's name or phone.
Its suggestion cannot directly create a pin. The verifier requires the same house,
street, city and ZIP, then either the existing independent geocoder or published
postal-address-plus-coordinate evidence from a government or official FMOL Health
facility page. Official pages use bounded, non-executing JSON-LD parsing, public
DNS, HTTPS, no redirects and exact premises matching. Conflicting coordinates,
incomplete addresses and unsupported evidence remain unresolved automatically.
Published facility coordinates are premises evidence, not a claimed entrance.

Verified evidence is atomically written to the existing shared service-address
review cache and read back. The next Schedule refresh consumes it. Conflicting
existing reviews cannot be overwritten. No JunkWare record is changed. Command >
Monitor shows queue status, evidence, estimated cost and reserved budget. This
worker does not create code patches, deploy changes, contact customers or ask the
operator to manually verify an address. A genuinely unlocatable address can remain
pending; the worker does not invent a location.

## Installation and operations

After the normal immutable release, run:

```sh
/bin/zsh /Users/missioncontrol/opscenter-v2/opscenter/deploy/macmini/install-maintenance-observer.sh
```

The installer manages only the new observer label. Each finite run resolves the
active release anew. Logs are in `~/Library/Logs/OpsCenter/maintenance*.log` and
contain status summaries only. A manual check uses the same locking launcher:

```sh
/usr/bin/python3 /Users/missioncontrol/opscenter-v2/opscenter/scripts/run-opscenter-observer.py
```

`OPSCENTER_MAINTENANCE_AI_DISABLED=true` disables AI for a worker invocation;
local detection continues. To stop the pilot entirely, boot out only its label.
Never reset the budget state. A stale heartbeat remains visible in Source Health.

Validate with `npm run verify:maintenance` (including isolated recovery fault
tests), operational-readiness checks, the
production build, and authenticated Command > Monitor verification. Fixtures
must use isolated temporary state and mocked provider responses. No synthetic
browser failures should be posted to production for testing. Do not intentionally
stop production to exercise recovery; verify the control and healthy no-action
path live and the outage/failure paths in isolated fixtures.

References: [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [API pricing](https://developers.openai.com/api/docs/pricing).

## Browser recovery evidence

Silence after a browser failure is unknown, even after its ten-minute reporting
window expires. An existing incident remains open until an administrator repeats
the affected signed-in interaction successfully and records the action and result
in Command > Monitor. The receipt must match the exact latest failure timestamp.
Three healthy observer checks then clear it; a newer failure invalidates the
receipt, including failures inside the server's count-throttle window.

Receipts live in separate `verified-<category>.json` files. They never rewrite
incident or spending history. Historical browser incidents cleared only by silence
reopen for review. Unknown and already-verified conditions cannot queue AI calls.
This is an administrator attestation, not an automatic browser test. Do not record
recovery from a build, health response, or a different interaction.

## Server continuity

Command > Monitor also shows the independent VPS observer described in
[Server continuity](server-continuity.md#independent-continuity-monitoring).
It has its own durable evidence and incident history and never enters this
pilot's AI queue or spending ledger. Its read-only checks continue on the VPS
when Mission Control is unavailable.

## Parish address preflight — prepared September 21, 2026

The existing minute map-input sweep checks today and every future collected
schedule date, including unassigned appointments. Policy 10 first checks East
Baton Rouge Parish's official street-address points for Baton Rouge, Zachary,
Baker and Central. This free lookup runs independently of the paid maintenance
ledger, research queue and browser. Census and OpenStreetMap remain fallbacks.

The parish result must match the complete house, street, city, state and ZIP.
An apartment uses only the explicitly published unsuffixed base-address point;
an explicit building requires that building. Apartment 4 never selects building
4. Distinct address IDs/coordinates, incomplete results, wrong projections and
conflicting identity remain unresolved. Pins locate service premises; they do
not establish an apartment entrance. Original unit instructions stay visible.

One shared disk reservation permits at most one parish request per minute across
processes, with an eight-second timeout and no redirects. Successful query
evidence lasts seven days; a definitive miss lasts six hours; outages retry
after one minute. Apartment variants share the base query cache. The existing
sweep still admits only four unresolved address checks per tick. The initial
policy change retries old failures while old successful evidence must pass the
current identity validation. No paid provider, budget or attempt limit changes.

Activation requires separately approving only `maps.brla.gov` in the installed
host inventory; the branch manifest is a proposal and cannot authorize itself.
Cost: $0, public parish GIS reads with no key, subscription or metered API. The
installed checker and protected paid-control hashes remain unchanged. Until
that explicit hostname approval, the production deployment gate must reject
this source. Never bypass it or construct an obscured hostname to evade review.

Validation includes synthetic identity/conflict/precision tests and the real
background sweep in isolated storage: tomorrow's address resolves before its
service date with the shared paid allowance exhausted, no open browser and no
paid request; another process reuses the persisted location.
