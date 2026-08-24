# OpsCenter data collection hierarchy

Status: Confirmed against production launchd definitions and integration docs
on 2026-08-24. Companion: [OpsCenter Slack alerts](slack-opscenter.md),
[Platform Kernel Architecture](PLATFORM_KERNEL_ARCHITECTURE.md).

This document answers three questions for every data stream OpsCenter
depends on: what collects it and how often, where it ranks when two sources
disagree, and whether a new fact in that stream reaches an operator
immediately or only on the next batch cycle. It exists so a change to any
collector's cadence, failure behavior, or alert wiring is made against a
known baseline, not from memory.

## Stream inventory

| Stream | Source system | Collector | Cadence | Failure behavior | Publishes to |
| --- | --- | --- | --- | --- | --- |
| JunkWare live metrics (jobs, estimates, payroll, schedule) | JunkWare | `run-junkware-live-refresh-loop.sh` (`com.openclaw.opsbot.junkware-collector`) | 180s target start-to-start; requires a real DNS answer for `junkware.junk-king.com` before each pull | Backs off 10s → 20s → 40s → 60s on consecutive failures, resets on success; holds the last valid snapshot rather than blanking data | `daily_metrics.json`; triggers the Slack alert publisher after each successful publish |
| JunkWare SMS-triggered refresh | JunkWare (via inbound SMS webhook) | Same loop, out-of-cycle trigger via `JUNKWARE_SMS_SIGNAL_URL` | Event-driven; runs immediately on signal rather than waiting for the 180s tick | Missing required output files fails that one refresh; queued date retried next signal or next cycle | Same as above, for the specific signaled date |
| JunkWare schedule detector (new/rescheduled/cancelled appointments, closeouts) | JunkWare | `run-junkware-schedule-detector.sh` (`com.openclaw.opsbot.junkware-schedule-detector`) | 10s poll, persistent process | `KeepAlive` restarts the process if it exits | Slack directly (territory jobs channel or truck channel), independent of the main loop |
| JunkWare per-market schedule watcher | JunkWare | `run-junkware-schedule-market-watcher.sh`, one instance per franchise (`com.openclaw.opsbot.junkware-schedule-market-watcher`, templated) | 10s poll, persistent process | Same as schedule detector | Feeds the schedule detector's market-confirmed state |
| JunkWare history reconciliation | JunkWare | `run-junkware-history-reconciliation.sh` (`com.openclaw.opsbot.junkware-history-reconciliation`) | Every 6 hours (21600s) | Not alert-gated; a backfill pass, not a freshness path | Historical/reconciled records only |
| LinxUp GPS and truck arrival | LinxUp | V3 Position Push webhook (`hooks.junk-king.app/api/integrations/linxup/push`), primary path; V2 poller (`run-linxup-live-refresh.sh`, `com.openclaw.opsbot.linxup-collector`) retained only as rollback/backfill | V3: event-driven, posts on every position update. V2 fallback: 60s poll | V3 push publishes the truck-arrival Slack alert directly on confirmed dwell (2-point, 2-minute, 125m rule); V2 restarts on any non-zero exit | Truck-channel Slack alert immediately on confirmed arrival; visit/GPS state |
| SearchKings marketing leads/calls | SearchKings | `run-searchkings-refresh.sh` (`com.openclaw.opsbot.searchkings-collector`) | Checks every 5 minutes, refreshes at most once per 15 minutes (`SEARCHKINGS_MIN_AGE_MINUTES`); redundant fallback also runs inside the main JunkWare loop | Isolated — a SearchKings failure does not affect JunkWare/QBO/Crew/VPS freshness, and vice versa; retains last verified snapshot on auth/network failure | `data/searchkings/current.json`, monthly snapshot; **no Slack alert route today** (see gap below) |
| QuickBooks Online payment reconciliation | QuickBooks Online (read-only) | Five-minute production collector (`collect:qbo`) | 300s, refreshes today and yesterday each cycle | Retains last verified reconciliation and reports the API error; never labels stale totals as current | Reconciliation JSON under `data/history/payment_reconciliation/`; Finance page |
| WhatsApp job photos and crew dump/fuel reports | Meta WhatsApp Cloud API | Signed webhook (`hooks.junk-king.app/api/integrations/whatsapp/job-photos`) plus `run-whatsapp-photo-worker.sh` background loop | Event-driven on inbound message; worker loop polls every 5s while busy, 30s idle for processing/retry | Ambiguous or unverified matches route to a review queue rather than auto-attaching | JunkWare appointment images/truck records; verified-batch Slack alert to truck channel |
| Crew Pay Portal | Derived from JunkWare payroll data already collected above | None — reads existing `daily_metrics` payroll records | N/A (consumption surface, not a collector) | N/A | `/my-pay` portal only |
| Browser session keepalive | N/A (infrastructure) | `browser_keepalive.sh` (`com.openclaw.opsbot.browser-keepalive`) | 300s | Not a data stream; supports the authenticated Playwright session every scraping collector depends on | N/A |

## Hierarchy

Four tiers, ordered by how quickly a real-world change is expected to reach
an operator:

**Tier 0 — event-driven, sub-minute.** LinxUp V3 position push, the
JunkWare SMS-triggered refresh, and the WhatsApp webhook. These fire on the
external event itself, not on a poll. Nothing should be added below this
tier's latency without a specific reason — it's the ceiling of what's
achievable given these are external systems OpsCenter doesn't control the
push timing of.

**Tier 1 — fast poll, treated as immediate.** The JunkWare schedule
detector and per-market watchers, at 10s. Fast enough that a 10-second poll
is functionally indistinguishable from event-driven for a human-paced
operation like dispatch, and this is the tier that owns "new appointment,"
"reschedule," "cancellation," and "job closeout" alerting.

**Tier 2 — steady refresh, minutes.** The main JunkWare metrics loop
(180s), QBO reconciliation (300s), and SearchKings (5min check / 15min
refresh gate). This tier is the source of truth for financials, payroll,
and marketing attribution — data where a few minutes of lag is acceptable
because the underlying business fact (a payment posting, a lead scoring)
isn't itself instantaneous.

**Tier 3 — periodic reconciliation, hours.** JunkWare history
reconciliation (6h). This tier exists to catch what Tier 1/2 missed, not to
carry fresh news — nothing operator-facing should depend on Tier 3 for
timeliness.

### Precedence when sources disagree

This follows the authority classification already established in
[the OS Constitution](OPSCENTER_OS_CONSTITUTION.md#what-opscenter-owns):
JunkWare, QBO, LinxUp, and SearchKings are each `source_authoritative` for
their own domain — OpsCenter never overrides them, only reconciles and
displays. Within a domain, the faster tier is provisional until the slower,
more authoritative tier confirms it: this is already the working pattern
for reschedules (documented in `PLATFORM_KERNEL_ARCHITECTURE.md` — "The
reschedule card shows a verified write immediately, while the authoritative
schedule collector moves the card on its next refresh"). The same rule
should be read across every tier boundary in this document: Tier 0/1 gets
something on screen and alerts fast, Tier 2 is what the Finance and
payroll numbers are actually computed from, and Tier 3 is the record of
last resort when the faster tiers disagree with each other.

## Alert immediacy audit

What you asked to confirm — "alerts for new incoming data need to be
immediate" — is already true for three of the streams and not yet true for
two.

**Already immediate:** LinxUp truck arrival (posts on confirmed dwell,
same event that produced the position push), JunkWare schedule/closeout
events (10s detector, posts once verified), WhatsApp job-photo batches
(webhook-triggered, posts once a batch is verified). Failed source
refreshes on the main loop are also alert-eligible — `docs/slack-opscenter.md`
already routes data-health incidents to `#ops-data-health`, which is what
should have caught the `data-collection-hardening.sh` incident sooner than
it did (see the companion incident writeup — the gap there was the deploy
pipeline's health check, not this alert path).

**Gap 1 — SearchKings has no alert route at all.** The routing policy
table in `docs/slack-opscenter.md` does not mention leads, calls, or
marketing conversions anywhere. A new qualified call, a call that flips to
**Lost** after 72 hours, or a **Recovered** match currently surfaces only
by someone opening the Marketing page — there is no push notification for
any of it, immediate or otherwise.

**Gap 2 — QBO/payment reconciliation exceptions aren't pushed.** A
`Missing in QBO` or amount-mismatch exception is real, actionable
information (a card payment that didn't land, or a reconciliation
discrepancy) but today it's Finance-page-pull-only, same as SearchKings.
Given the collector already runs every 5 minutes and already distinguishes
exceptions from clean matches, wiring new exceptions into the existing
`#ops-data-health` or a dedicated finance-alert channel would close this
without adding a new collector.

Neither gap needs a new collector or a faster poll — both already run on a
reasonable Tier 2 cadence. The gap is entirely on the publish side: nothing
currently reads their output and decides "this is new, and someone should
be told."

## Recommendation

Treat "alert route exists" as a required field for every stream in the
inventory table above, the same way `docs/slack-opscenter.md` already
requires deduplication and baselining for the streams it covers. The two
gaps identified here are the concrete next work: extend the Slack publisher
(`scripts/publish-slack-alerts.ts`) to check SearchKings lead/call state
transitions and QBO reconciliation exceptions on their existing collector
cadence, using the same baseline-once/dedupe-after pattern already proven
for appointments and closeouts, rather than inventing a new alerting
mechanism for either.
