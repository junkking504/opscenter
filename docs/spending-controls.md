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

The approval file is outside releases at
`~/Library/Application Support/OpsCenter/spending-policy.json`. Version 1 uses
`default: "deny"`, a global `paused` switch, and an approval named
`maintenance-diagnosis` with id `maintenance-pilot-20260908`, `enabled: true`,
provider `openai`, model `gpt-5.6-luna`, and `monthlyBudgetMicros: 10000000`.
Setting `paused: true` stops new maintenance AI requests while observation
continues. No environment flag or API key can create an approval.

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

## Kingpin and Convoy hostnames — September 18, 2026

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
