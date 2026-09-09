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
- The previously approved maintenance pilot is the sole metered application
  feature: OpenAI `gpt-5.6-luna`, standard service tier, no tools/images,
  2,048 output tokens and a bounded text request. Maximum $10 per Chicago
  calendar month and 500 attempts per month, whichever stops it first.
  The worker serializes execution, durably reserves $0.02 before each attempt,
  keeps uncertain reservations, and pauses on unexpected usage. Missing or
  damaged history and missing or mismatched approval stop requests.

The approval file is outside releases at
`~/Library/Application Support/OpsCenter/spending-policy.json`. Version 1 uses
`default: "deny"`, a global `paused` switch, and one approval named
`maintenance-diagnosis` with id `maintenance-pilot-20260908`, `enabled: true`,
provider `openai`, model `gpt-5.6-luna`, and `monthlyBudgetMicros: 10000000`.
Setting `paused: true` stops new maintenance AI requests while observation
continues. No environment flag or API key can create an approval.

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
