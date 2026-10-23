# Spending controls

Credentials authenticate requests; they do not authorize spending. New metered
features remain off until the user explicitly approves the provider, purpose,
request limits and maximum spend. Implementation and deployment approval alone
do not grant spending approval. Free credits and budget alerts are not caps.

## Current policy

- Google Maps paid integrations are retired. Maps, geocoding and road ETAs use
  the existing non-Google implementation. Do not re-enable Google APIs.
- Automatic truck-photo AI estimates are blocked. Their queue items go to human
  review without repeated provider retries. Manual fullness/content entries and
  ordinary appointment photo uploads remain available.
- The maintenance diagnosis pilot remains approved: OpenAI `gpt-5.6-luna`, standard service tier, no tools/images,
  2,048 output tokens and a bounded text request. Maximum $10 per Chicago
  calendar month and 500 attempts per month, whichever stops it first.
  The worker serializes execution, durably reserves $0.02 before each attempt,
  keeps uncertain reservations, and pauses on unexpected usage. Missing or
  damaged history and missing or mismatched approval stop requests.
- The Ask OpsBot pilot is approved for OpenAI `gpt-6-luna`, standard service
  tier, local read-only OpsCenter function tools, no web search, no files or
  images, and at most 1,200 output tokens per model call. The pilot has 50 total
  questions across all managers and a $10 Central calendar-month cap. Each
  question durably reserves $0.20 before the provider request; failed or
  uncertain requests remain counted. Missing or damaged approval or ledger
  state stops requests.

The approval file is outside releases at
`~/Library/Application Support/OpsCenter/spending-policy.json`. Version 1 uses
`default: "deny"`, a global `paused` switch, and an approval named
`maintenance-diagnosis` with id `maintenance-pilot-20260908`, `enabled: true`,
provider `openai`, model `gpt-5.6-luna`, and `monthlyBudgetMicros: 10000000`.
Setting `paused: true` stops new maintenance AI requests while observation
continues. No environment flag or API key can create an approval.

The Ask OpsBot approval is named `ask-opsbot`, id
`ask-opsbot-pilot-20260924`, enabled, provider `openai`, model `gpt-6-luna`,
`monthlyBudgetMicros: 10000000`, `maxQuestions: 50`, `reserveMicros: 200000`,
`maxOutputTokens: 1200`, `serviceTier: "default"`, `store: false`,
`webSearch: false`, and `fileUploads: false`. The 50 slots are a lifetime pilot
limit and do not reset monthly; therefore they cannot reserve more than $10 in
any month. The user approved this feature, model, limit, cap, and reuse of the
existing OpenAI credential on September 24, 2026.

## Address investigation approval — September 13, 2026

The user approved extending the existing worker and OpenAI credential to research
unresolved service addresses. This shares the existing $10 monthly ledger and
500-attempt limit; it does not add another $10 budget. Each canonical address
gets at most one paid attempt over its lifetime, including suite variants,
different appointments and future months. The worker reserves the entire $0.10
allowance durably before sending the request. Unknown usage keeps that reservation.

The additional approval is `address-investigation`, id
`address-investigation-20260913`, enabled, provider `openai`, model
`gpt-5.6-luna`, `monthlyBudgetMicros: 10000000`,
`sharedBudget: "maintenance-diagnosis"`, `perAddressBudgetMicros: 100000`,
`maxAttemptsPerAddress: 1`, `maxSearchCalls: 1`, `maxOutputTokens: 2048`.
All fields must match; the existing global pause applies to both features.

Each request uses standard tier, low reasoning, one built-in web search with low
context, no conversation continuation and at most 10 KB of serialized input.
At the reviewed prices, settlement includes $0.01 per search plus $0.20/M input
and $1.20/M output tokens. The search context is limited to 128K tokens by the
provider; the 10-cent reservation exceeds this bounded request's expected cost.
Unexpected model or usage pauses further AI requests. These are application
controls, not a provider account-wide billing guarantee. No paid retry, automatic
code repair, new provider, Google API or subscription is authorized here.

The reviewed spending gate and hashes must be installed together for this
explicitly approved feature, preserving the existing policy and budget history.
Tests use mocked providers and isolated state only.

## Deployment boundary

`npm run verify:spending` tests denial behavior and scans external endpoints,
runtime dependencies and metered call sites. Production and preview builds also
run a separately installed copy from
`~/Library/Application Support/OpsCenter/deployment-control/` before installing
dependencies. Its `approved-service-hosts.json` pins the hashes of spending
controls. Editing a branch's checker or allowlist cannot change that installed
decision. Do not refresh those installed files in routine deployment.

After an explicitly approved spending-control review, install the reviewed
`scripts/verify-spending-boundary.mjs` and `scripts/approved-service-hosts.json`
to that directory together, record their SHA256 checksums, and keep permissions
read-only. The normal controller installer must preserve them. A missing gate
fails the deployment. The endpoint list is an inventory of existing integrations,
not permission to enable paid operations on those hosts.

## Limits of the controls

### Geocodio free fallback — approved September 24, 2026

The user approved trying Geocodio for unresolved service-address geocoding on
the free tier only: **$0 maximum spend**, no subscription, payment method,
paid credits, data appends, routing or overages. Geocodio advertises 2,500 free
lookups per day and provider cutoff on free accounts. Before activation, verify
the actual account has no payment method and remains free; credentials alone
are insufficient. See [Geocodio setup](geocodio-free-fallback.md).

The new endpoint is only `api.geocod.io`, single-address `/v2/geocode` with
`q` and `country=USA`; authorization is a server-only header. The branch
inventory pins both new Geocodio modules. Installing that reviewed inventory
is an explicit part of this approved integration, not a routine deployment
refresh. Preserve every other installed approval/hash and the unchanged checker.
The account was browser-verified with no payment method, zero purchased credits
and a persisted 2,500/day provider cutoff. A single-geocoding-only key is stored
privately. The installed inventory adds only this host and the two module pins;
its prior pair is retained under `geocodio-free-approval-20260924T141300Z`.

Requests share a durable, process-locked ledger: at most 2,500 attempts in any
rolling 25 hours, at least ten seconds between starts, and at most eight seconds
per request within the existing address lookup deadline. Failures count; missing
or corrupt history and stale locks block calls. No automatic account upgrades
or paid retries exist. Approval expires after at most 31 days for account review.
This does not increase or draw on the existing OpenAI $10/500-attempt budget.

These checks prevent accidental reintroduction through the documented workflow;
they are not a network firewall or a provider-enforced account-wide dollar cap.
An administrator can change code, credentials, account settings or these files.
Subscriptions, ad accounts, another machine and separately invoked tools have
their own billing. New approved usage should use dedicated restricted provider
credentials and provider-enforced quotas wherever available. Verify actual
provider invoices separately; local estimates are not invoice reconciliation.

## Crew jobs hostname — September 18, 2026

The user explicitly approved adding only `jobs.junk-king.app` to the installed
hostname inventory. It uses the existing Cloudflare DNS and Mission Control tunnel
for the company-phone app, with zero new charges authorized. The checker is
unchanged; no provider, dependency, paid service, quota or spending limit changes.
The installed checker and one-hostname manifest update are backed up and recorded
with SHA256 checksums in the external deployment-control installation record.

## Company-phone setup delivery — prepared September 18, 2026

The user approved Meta WhatsApp authentication-template delivery for company-phone
setup, capped at **$1 and 100 send attempts per Central calendar month**. The
verified North America authentication rate was $0.0034 per delivered message on
September 18. The implementation reserves $0.01 per attempt without refunds.
Eugene Dabezies's saved manager phone was explicitly selected for one test.
Template approval, protected configuration and deployment must be verified before
claiming that sending is active or a message was delivered.

The separate private approval file is
`~/Library/Application Support/OpsCenter/crew-phone-delivery-approval.json`.
It must contain `schema: 1`, `enabled: true`, `provider: "meta-whatsapp"`,
`purpose: "crew-phone-setup"`, explicit `approvedBy`/`approvedAt`, a future
`validUntil`, `monthlyBudgetMicros`, `maxAttemptsPerMonth`, `reserveMicros`, and
the approved authentication `template` and `language`. This implementation permits
at most $1 and 100 attempts per Central calendar month, reserves at least one
cent per attempt, and never refunds uncertain or rejected attempts. The approved
reservation must cover the verified recipient-market rate. Approval expiration
requires a rate/template review before renewal. These application reservations
are not a Meta account-wide billing cap. Test overrides must use isolated files.

Do not install an approval file, change the separately installed spending gate,
or enable paid sends as part of routine deployment. Activation remains a separate
explicit user decision. A missing/corrupt/expired/disabled approval fails closed.

The September 18 user approval authorizes installing this feature's private
approval file; it does not authorize changing the separate deployment spending
checker or existing AI budgets. Optional `testRecipientName` and `testRequestId`
authorize exactly one idempotent test send to a uniquely matching saved manager
contact. The browser cannot choose an arbitrary destination. Remove these test
fields after acceptance; normal sends continue to use the company-phone directory.

On September 19, the user explicitly enabled their saved manager phone ending
2072 for Waypoint testing after an ineligible-number request silently produced no
send. The private `selfSetupTestRecipientName` permits exactly one uniquely
matching saved manager contact to request its own code. It does not allow all
manager phones or arbitrary destinations. The existing expiry, $1/100-attempt
monthly cap, one-cent reservation, ten-minute self-request cooldown and three
sends per phone per day apply. Removing that field stops new test sends. This
setting is separate from the older single-request manager test action and must
not be enabled for other recipients by a routine deployment.

On September 20, the user explicitly requested enabling two additional saved
manager phones for Waypoint testing. `selfSetupTestRecipientNames` supports an
explicit list alongside the existing singular setting, preserving the original
recipient. Each name and number must uniquely match the private manager directory;
requests select only the matching caller number. All recipients share the same
existing $1/100-attempt monthly ledger, expiration and per-phone limits. This
recipient-only approval does not raise spending limits or enable arbitrary manager
numbers. Tests use mocked sends; do not claim handset delivery from eligibility.

## Kingpin and Convoy hostnames — September 18, 2026

### Daily Waypoint setup expansion — approved September 29, 2026

The user approved as many setup messages as necessary for daily enrollment and
added the Operations company phone. The approved scope is six company identities
and three named personal identities; every enrolled crew member still selects
today's truck and crew. The runtime allowance is **837 attempts and $8.37 reserved
per Central month**, enough for all nine identities at the existing three-request
daily limit for 31 days. One cent remains reserved for every attempt; the
ten-minute cooldown, durable ledger, single-use code, approval expiry and
no-automatic-replay rules remain. No messages are scheduled automatically.
Numbers and named personal approvals remain outside Git. This supersedes only
the September 18 setup-message volume/cap and recipient scope, not other service
approvals or budgets. The external deployment spending checker is unchanged.

The user explicitly approved adding only `kingpin.junk-king.app` and
`convoy.junk-king.app` to the installed hostname inventory for the app rename.
Both use the existing Cloudflare DNS and Mission Control tunnel, with $0 in new
charges authorized. Legacy jobs and inspect origins remain available for existing
phone sessions and drafts. The checker, provider permissions, dependencies, quotas
and all spending limits remain unchanged. Back up the installed pair and record
the approved inventory and checker SHA256 hashes in the external installation record.

## Waypoint hostname — September 19, 2026

The user explicitly approved adding only `waypoint.junk-king.app` to the
protected hostname inventory and existing Cloudflare DNS/Mission Control tunnel
for the Kingpin-to-Waypoint rename, with $0 in new charges. The Kingpin and jobs
origins remain available for existing sessions and drafts. No paid service,
provider permissions, budget, quota, checker or other policy changes are included.
The installed inventory backup and unchanged checker hash are recorded in the
external deployment-control installation record.

## East Baton Rouge Parish GIS hostname — September 24, 2026

The user explicitly approved adding only `maps.brla.gov` to the protected
hostname inventory for exact service-premises preflight. The public parish GIS
requires no key, subscription or metered API and authorizes $0 in new charges.
The existing shared $10/500-attempt paid address limits, Google API retirement,
providers, dependencies and checker remain unchanged. Back up the installed
pair and record the new inventory hash plus the unchanged checker hash in the
external installation record before production deployment.

## St. Tammany Parish address lookup — approved October 3, 2026

The user explicitly approved adding `maps.stpgov.org` to the protected hostname
inventory for the free parish address-point preflight, with $0 maximum spend.
The public endpoint requires no API key, subscription or billing account. It
uses the existing parish request reservation and cache. The reviewed Geocodio
verifier change classifies nearest-house suggestions as missing exact coverage
instead of competing exact premises; it does not accept those suggestions.
Only that module pin changes. The checker, Geocodio transport, all paid limits,
other hostnames and dependencies remain unchanged. Back up the installed pair,
record checksums and preserve read-only permissions when installing approval.

## Local resale photo decoder — approved October 5, 2026

The user approved declaring the already-transitive `sharp` library directly for
resale image validation, orientation and metadata removal. The direct dependency
is pinned to **0.35.3**, the version already resolved through Next.js 16.3.0. The
lockfile retains the same package versions, registry integrity and native image
components; no new resolved package is introduced. Sharp is Apache-2.0 licensed
and processes bytes locally. Uploads use bounded file sizes and decoded pixels.
No external endpoint, credentials, metered request, paid service, quota or budget
change is authorized. This approval does not authorize a deployment.

The supported dependency review adds only `sharp` to the approved dependency
inventory, with review metadata. Preserve the unchanged checker, host inventory
and all protected-file hashes. Back up the installed checker/inventory pair,
install the reviewed pair with read-only permissions, and record both SHA256
checksums and the approval source in the external installation record. Then run
both repository and installed gates plus the normal build and regressions.

## Apple Web Push signing setup — approved October 18, 2026

The user approved adding only `web.push.apple.com` to the existing hostname
inventory and creating/configuring protected OpsCenter VAPID signing credentials,
with $0 additional service cost. The checker, other hosts, dependencies, protected
file hashes, quotas and all paid limits remain unchanged. The installed inventory
and unchanged checker were backed up; their SHA256 hashes are recorded in the
external installation record. No broad network/firewall policy was changed.

The private signing key is in the user Keychain under account `opscenter`, service
`com.opscenter.web-push-vapid-private-key`, with access limited to the existing
`/usr/bin/security` loader. No all-application ACL is granted. The feature branch
extends `scripts/load-opscenter-secrets.sh`; that extension is not deployed and
loads the new key only when Mission Control push is explicitly enabled.
Only the public key, existing support contact, HTTPS origin, disabled flag and
blank activation timestamp were added to mode-0600 `production.env`. No private
key is written to source, environment files, logs, patches or evidence artifacts.

This approval does not authorize deployment, database migration, worker scheduling,
live sending, device subscription or a paid reviewer. Independent Claude review
remains pending. Both host inventories can pass now; that is not permission to
merge or deploy. See [Web Push activation boundaries](web-push.md).

## Claude second-opinion review — requested October 20, 2026

The user asked for Codex to call Claude Code for a second-opinion review of its
changes. `claude-review.sh` runs the locally installed, logged-in Claude Code on
the builder's machine and draws on that Claude subscription. Each review is
capped at 40 turns.

**Approved: October 21, 2026.** The user first confirmed paid extra usage was
off, then asked to use credits and set a **maximum of $20 per month** for paid
extra usage (usage credits) on the Claude account Claude Code is logged in with.
That cap is the maximum new spend for this feature. It is not enforced by the
script, which cannot read the account's limit: the user sets $20 as the monthly
spend limit in the account's usage settings, and no auto-reload or higher limit
is approved. Reviews past the plan limit may bill against that credit until the
limit is reached; then the review fails and Codex continues without it.

`claude-review.sh` refuses to run (exit 8) unless the line below, which only the
user's own approval may add, is present. Remove it to stop reviews, for example
if the cap is lowered or removed.

<!-- claude-review-extra-usage: capped-usd-20-monthly -->

The earlier `confirmed-off` line in the Waypoint section below is a separate
statement for another review and does not enable this script.

The script fails closed. It calls Claude Code with an allowlisted environment,
so no API key, auth token, base URL, or Bedrock, Vertex or Foundry switch is
inherited, and with `--restricted --setting-sources ""` so no settings file can
supply an `apiKeyHelper` or environment. Before the review it runs
`claude auth status` and stops unless the login is first-party, a Claude
subscription (`claude.ai` or `oauth_token`), with no API key source.
Admin-managed Claude Code settings still apply and are checked by the same
status call, and the script refuses to run when admin-managed settings
(managed-settings files, an MDM profile) exist, when the login is a Team or
Enterprise plan or does not report a Pro or Max plan, or when server-managed
settings are cached. OpsCenter, collectors and scheduled jobs never run the script.
This does not approve hosted or API-key review. Validation:
`npm run verify:claude-review`.

<!-- claude-review-extra-usage: confirmed-off -->

On October 21, 2026 the user confirmed Claude paid extra usage is off for the
subscription-only Waypoint Operations code-delivery review. No paid fallback.

## Waypoint crew notifications — October 21, 2026

User approved ongoing iPhone crew alerts for schedule/route updates and office
messages. Reuses the existing Apple Web Push host and VAPID key via a separate
crew-only sender. No new provider/SDK, billable inference, subscription or Meta
call. Existing source cadence is unchanged. Permission is an explicit crew tap;
phone/truck/day authorization remains distinct from manager notification grants.
See [Waypoint notifications](waypoint-push.md). This does not reset/promote the
manager trial or change its limits.

## Pushover manager notifications — approved October 22, 2026

The user approved replacing native delivery for their one verified manager phone
with Pushover, sending the existing schedule, crew and fleet alert details, using
the phone's default Pushover sound and normal priority. Approval includes one
synthetic setup test, up to 10,000 attempts over at most 30 days, and $0 additional
API spend. Existing earlier phone authorization expiry still applies. No automatic
renewal, paid upgrade, subscription, license purchase or overage is authorized.

The reviewed host inventory adds only `api.pushover.net`. Preserve the unchanged
checker, all other hosts, dependency inventory and protected-file hashes; back up
and record the installed pair before applying this specifically approved change.
Private configuration and durable nonrefundable quota state live outside Git. Each
attempt permits at most one validation and one message request. See [Pushover](pushover.md).
