# Maintenance reliability spending-control review — pending approval

This is a proposed release. The installed checker, installed allowlist, spending
policy, live ledger, credentials, and active release have not been modified.

## Requested approval

Approve the three file fingerprints below for the installed spending gate, then
perform the normal forward-only production release and authenticated live QA.
The checker itself is unchanged. All other protected fingerprints, host entries,
and dependency entries are unchanged. This approval does not authorize new
providers, new paid products, higher limits, or billing/account changes.

## Unchanged spending contract

- Existing maintenance-diagnosis approval only; OpenAI gpt-5.6-luna.
- Standard tier, text only, no tools/images; 2,048 maximum output tokens.
- $10 and 500 attempts per Chicago month, whichever stops requests first.
- $0.02 durable reservation before each request; uncertain reservations retained.
- Missing/corrupt ledger and absent/mismatched approval fail closed.
- No API request was made for testing. Provider responses were mocked.

## Changes under review

1. maintenance-monitor: consume existing operational signals; accept only fixed
   operation/method/failure/status values from browsers; hold unverified browser
   failures open; preserve recent diagnoses/attempts across recurring incidents.
2. maintenance-diagnosis: retain assessments for 24 hours across recurrence;
   record only allowlisted provider codes; pause on known quota/access failure;
   back off six hours for ambiguous 429 and one hour for ordinary transient errors.
   Preserve provider failure state when no request is attempted, rather than
   displaying Ready without a successful request.
3. observe-opscenter: run bounded local Schedule/Fleet data-view checks every five
   minutes. These use cached local inputs and emit booleans only; no new provider
   requests, synthetic customer writes, or authentication bypass.

### lib/maintenance-monitor.ts

Previous: `e6d43bd72503ca0b88c6a96af5d7d6fd2876a04dd68ba3afa8c7288653907f9d`

Proposed: `a9bd78ccb69f50ebfddd8b613bc2609ab1fd4e13edfb72b4e63e6398e8f9779d`

### lib/maintenance-diagnosis.ts

Previous: `95d1a7c7a2725d803588490efb168945a9cb676e6e9b82d063c8b469236f46c8`

Proposed: `62161edda774f81cf13ff8408e2714b307b65c88bfbfdaee4ecbed5a75ef047c`

### scripts/observe-opscenter.ts

Previous: `c78a3bee84507b0ed469397901343a6fdde8b3e12dc1b4fb7b2071816953763c`

Proposed: `6db03154a30b0c13f77429793a10f4287aa85ed76c783abcb731c04e638121fb`

## Verification and limitations

Targeted maintenance, HTTP and browser-telemetry suites passed with mocked
providers. All 17 process-recovery regressions passed. TypeScript, spending
regressions and the production build passed against the proposed local manifest.
Synthetic browser QA verified the notice, HTTP 503 evidence, pending verification,
and stale-check warning. The temporary test server was stopped after QA. The separately installed gate must still reject the
three changed files until this review is explicitly approved.

Schedule/Fleet checks exercise data assembly, not every rendered interaction.
Command and other browser failures are observed in active authenticated sessions.
An operator verification records the exact failure timestamp; newer failures
cannot inherit it. There are no external notifications or additional repair tools.
Known quota/access failure pauses AI until a separate provider investigation and
explicit resumption; do not delete/reset the usage ledger to recover it.

The current production HTTP 429 cannot be classified retrospectively: the prior
worker discarded the provider code. The next normally scheduled request after
release can retain that safe code. This candidate cannot promise to correct a
provider billing/access problem without identifying it and obtaining any required
account/spending approval.
