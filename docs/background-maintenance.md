# Background maintenance observation pilot

The separate `com.openclaw.opscenter.maintenance` LaunchAgent observes OpsCenter
once a minute. Command > Monitor shows current and cleared conditions, measured
evidence, AI suggestions, worker freshness, and monthly usage. Source Health
also reports missing/stale observer heartbeats. All pilot behavior is observation
only: there are no repair tools, shell execution by AI, source-system writes,
automatic deployments, or outbound messages.

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

Validate with `npm run verify:maintenance`, operational-readiness checks, the
production build, and authenticated Command > Monitor verification. Fixtures
must use isolated temporary state and mocked provider responses. No synthetic
browser failures should be posted to production for testing.

References: [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [API pricing](https://developers.openai.com/api/docs/pricing).
