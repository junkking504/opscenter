# Ask OpsBot

Ask OpsBot is the read-only GPT-6 Luna assistant inside OpsCenter's global
search panel. Managers can type a question and deliberately select **Ask
OpsBot**. Ordinary typing, source search, and Second Brain answers do not make a
paid request.

Monthly or month-to-date revenue attributed to a named employee is answered
first from the existing Krewe monthly read model. This deterministic path
requires a unique employee match, returns credited revenue, employee job
credits, source freshness and missing-date coverage, and does not reserve a
pilot question or call the AI provider. Busiest-weekday questions by territory are calculated locally from non-provisional
`jobs_by_market` daily history, defaulting to the last 365 completed calendar
days before the earlier of today and the selected day. Rankings compare average
jobs on positive-job territory days, require three observations per weekday,
normalize existing territory labels, retain ties, and disclose missing coverage.
Rolling 7–365 day requests are supported. Average jobs per day by territory
uses the same full historical range, returning total jobs, recorded-day count,
recorded-day average including explicit zeros, and positive-job-day average.
Absent territory counts and missing dates are excluded and disclosed separately;
they never become zero. This is an observed average, not a verified complete
calendar-period average when coverage is missing. These answers consume no AI question.
Enter submits a natural-language question; record searches retain result navigation.
Local answers remain available when the paid pilot is paused or exhausted.

Saved-source lookup also answers simple clocked/worked crew, booked schedule,
named employee day/week/pay-period gross, saved daily revenue/sales/expense/profit,
truck daily performance, and saved call-in plan questions. Call-in answers read
only persisted decisions for the target date without rebuilding recommendations;
Recommended/Called is not confirmed availability. Relative dates resolve from the selected
operating date. Invalid dates, conflicting date selectors, ambiguous employees,
recommendations, mutations, comparisons and unsupported historical ranges do
not become a guessed local answer. Missing source values are unavailable, not
zero. Schedule rows remain scheduled evidence, not clock-ins; daily truck
performance cannot establish readiness, location or availability. Daily finance
metrics are labeled unreconciled, not represented as accounting/payment truth.

Both the local endpoint and the paid endpoint's POST first try this bounded
saved-source path after session/manager/same-origin/body checks. The paid
endpoint returns a matching local answer before spending approval, credential
lookup or ledger reservation. A local source failure returns 503 rather than
triggering a paid request or collection. Local responses retain no-store headers.
Returned facts include observed timestamp, historical/partial/future labels,
missing-date coverage for payroll, and a live-use stale label after 15 minutes;
this threshold is a lookup warning, not a replacement for collector authority
policies. Verified payroll corrections use the existing correction projection,
and weekly overtime uses the existing employee portal calculation at saved hours.

Only the chosen domain's reader is invoked. Daily metrics are reused by date
inside that one lookup, and repeat identical safe provider tool projections are
reused inside one question. No user, conversation, payroll record or tool result
is cached across requests. The next request reads current saved sources again;
no TTL or invalidation daemon is needed. Local output contains only the requested
answer and source links, not raw customer contacts, audit actors or receipt IDs.
There is no new database, collector, scrape, source rebuild or operational write.

Unsupported questions continue to the
bounded GPT-6 Luna path.

## Evidence boundary

Ask OpsBot can read bounded schedule facts, aggregate financial reconciliation,
aggregate crew-pay totals, per-truck advisor summaries, OpsCenter search
matches, and source-health status. It cannot write records,
dispatch trucks, contact customers, browse the web, upload files, or continue a
stored OpenAI conversation. Every question starts a stateless Responses API
tool loop with `store: false`. Customer names, addresses, phone numbers,
individual payments, employee names, rates, individual pay, credentials, and
hidden prompts are excluded from tool output. The deterministic monthly
attribution answer can repeat the uniquely matched employee name already present
in the manager's question, but it does not return the rest of the roster,
payroll details, rates, or individual payments.
The new named-pay deterministic answer may show the uniquely matched employee's
gross, hours, wage/tip/bonus components to the existing authenticated manager
role. Clock/work queries may show worked crew names. These facts stay in the
local manager response; they are never added to provider tool payloads, and the
provider's existing individual-pay/name prohibition remains intact.

The answer names the OpsCenter sources it used. Source links reopen the relevant
OpsCenter record. Stale, missing, historical, and inferred evidence must remain
explicit in the answer.

## Access and limits

Only authenticated manager and administrator roles can view or call the route.
The server checks same-origin requests, the separate spending approval, the
OpenAI credential, and a private durable ledger before reserving a question.

The pilot is limited to 50 total questions shared by all managers. A question
reserves $0.20 before contacting OpenAI, so the 50 slots also enforce the
approved $10 maximum. Provider errors and uncertain requests stay counted. If
the ledger, approval, or usage record is missing, invalid, exhausted, or paused,
Ask OpsBot fails closed while deterministic OpsCenter search remains available.

See [Spending controls](spending-controls.md) for the exact approval shape and
deployment boundary.

Verification: `npm run verify:ask-opsbot` includes synthetic saved-source and
actual HTTP-handler tests with injected auth, readers, provider and ledger.
No live provider request is required. The local module and existing UI early
return work when the paid pilot is disabled; this is not an end-to-end outage
certification for every feature in OpsCenter.
