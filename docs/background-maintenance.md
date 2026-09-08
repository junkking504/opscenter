# Background maintenance pilot

The separate `com.openclaw.opscenter.maintenance` LaunchAgent observes OpsCenter
once a minute. Command > Monitor shows current and cleared conditions, measured
evidence, AI suggestions, worker freshness, and monthly usage. Source Health
also reports missing/stale observer heartbeats. AI remains advisory. A separate
fixed Python policy can start a confirmed stopped OpsCenter process. There is no
shell execution by AI, source-system repair, automatic deployment, or outbound message.

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
of any provider dashboard alerts. It durably reserves $0.02 before every call.
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
