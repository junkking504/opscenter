# WEX fleet fuel

OpsCenter reads posted WEX fuel-card transactions from the CSV export in the
authenticated WEXOnline portal. The portal feed is an interim source while WEX
reviews the request for Fleet Management API credentials.

## Source boundary

- Only the **POSTED** transaction export is imported. Pending and declined
  authorizations are excluded because a single purchase can have more than one
  authorization stage.
- WEX `Trans ID` is the stable identity. Reimporting the same export is
  idempotent, and conflicting rows with the same ID fail closed.
- Published daily fuel expense remains authoritative when present. The selected
  day's posted WEX net cost fills a missing or zero published fuel field once;
  it is not added again when published expenses already contain fuel.
- Capital and Command show the same selected-day Revenue, Labor, combined Dump
  + Fuel card with individual dump and fuel totals, and Net. WEX transaction
  detail remains visible in Capital so the fuel total is auditable.
- Month-to-date published costs retain their existing source boundary until the
  daily WEX coverage is complete for that reporting period.
- The UI shows the import time and the latest transaction date covered by the
  export. A saved snapshot is not represented as a fresh portal read.

## Import

Imports merge by transaction ID and preserve prior purchases outside the new
export's date range. Conflicting saved IDs stop the import before replacement.
A single-writer lock prevents concurrent imports. A lock left by an interrupted
process requires operator investigation; never delete it while an importer runs.

## Reconciliation and entry alerts

Capital's Fuel Reconciliation compares individual verified JunkWare fuel entries
with posted WEX purchases for the selected purchase date (not the posting date).
Both source amounts remain visible. A match requires an exact normalized truck
and date plus either the same receipt/ticket or a compatible merchant and a
recorded time within 30 minutes. Each side must have exactly one candidate.
Equal totals alone cannot match purchases. Multiple candidates remain for review.
Repeated reports with the same truck, time, receipt, location and amount remain
visible as possible duplicates, including observations under different markets.
Their combined reported total stays unavailable until source identity is resolved.

The comparison uses WEX Total Fuel Cost, with Net Cost shown separately. Net Cost
can be used as the comparison only when the fuel portion is absent and non-fuel
cost is explicitly zero. Differences remain unresolved; reconciliation never
edits JunkWare, QBO or published daily amounts. Unmatched reports say Awaiting
WEX match because posting delay, another payment method or missing coverage may
explain the absence. An unmatched WEX purchase is not proof of an unreported
expense when JunkWare detail coverage is incomplete.

Reported fuel entries keep the existing JunkWare/OpsBot alert path to the truck's
Slack channel and Command timeline. Entry alerts do not wait for a WEX match.
The publisher records delivery identity to avoid repeated alerts; OpsBot-owned
deliveries suppress a duplicate source alert. Initial historical snapshots are
silently baselined. Reconciliation itself adds no external polling or message publisher.
The automation publisher below runs only from a newly imported posted export;
it does not turn a retained snapshot into a live portal read.

After an existing snapshot has established the baseline, each newly posted WEX
transaction is queued for expense automation. OpsCenter compares the merchant
street address and transaction time with retained LinxUp stops, trip endpoints,
and nearby GPS points at a previously observed station coordinate. A truck is
assigned only when exactly one truck matches. Ambiguous or unavailable matches
are held for review and do not create a JunkWare expense.

For an attributed transaction, OpsCenter first checks verified JunkWare fuel
expenses for the same truck, date, amount, location and time. A unique match is
reused; otherwise one idempotent Gas record is created in JunkWare. The truck's
Slack channel then receives the posted amount, merchant, location, transaction
time, LinxUp attribution evidence, and whether a new record was created or an
existing manual record was reused. The worker rechecks JunkWare before writing,
and later WhatsApp manual submissions are checked against pending and completed
WEX automation records so only one expense remains. The first-ever import is a
baseline and does not backfill historical Slack or JunkWare records.

Validation: `npm run verify:wex-fuel`, truck expense notification checks,
TypeScript, desktop build and production build.

## Import command

From a source checkout:

```sh
npm run import:wex-fuel -- ~/Downloads/Transactions.csv
```

The protected runtime snapshot is written to
`~/.openclaw/workspace/opsbot/data/integrations/wex-fuel/posted-transactions.json`
with mode `0600`. Set `WEX_FUEL_DATA_DIR` to use another directory or pass an
explicit output file as the second argument.

## Sign-in

The WEX tab uses the dedicated Chrome `OpsCenter` profile. Keep that browser
profile and tab open to retain WEX's session cookie. WEX controls session expiry
and can require 2FA again; OpsCenter must stop refresh and request sign-in when
that happens. It must never report the prior snapshot as a fresh portal read.

## API migration

WEX's Fleet Management API uses provider-issued credentials. Before enabling
requests, confirm WEX's fees and rate limits, then obtain explicit approval for
the provider, purpose, request cap, and maximum spend under
[spending controls](spending-controls.md). The API collector should write the
same snapshot schema so Finance does not need a second source model.

## Provisional daily records from email alerts

The internal `integrations/wex-fuel/alert-expenses.json` journal accepts the same
minimized Outlook message batch as price ingestion. It retains exact message IDs,
tracking numbers, original authorization local time, received UTC/offset time,
source links and all authorization revisions. Card/account identifiers and raw
email boilerplate are not stored. Authorization timezone remains unconfirmed;
the daily view uses the date stated in the alert and never invents a UTC instant.
Missing gallons prevent price calculation but do not discard a monetary alert.

`node --import tsx scripts/import-wex-alert-expenses.ts <private-file> --dry-run`
prepares aggregate counts and a snapshot hash. After the required source-write
approval, use `--expected-sha256=<hash>` for the same private input. A single-writer
lock and atomic replacement protect updates. The same message ID with changed
content fails closed; exact replay adds no record and does not freshen import
metadata. Changed amounts under one tracking number remain revisions of one
record. Reversals/declines do not contribute a provisional amount. Conflicting
identity/timing or a new authorization following reversal stays for review.

Capital's daily expense view reads these records through the existing Finance
read endpoint. Provisional authorizations are explicit separate amounts, never
added to `DailyFinanceSummary.fuel`, published total costs/net or posted WEX
amounts. Published aggregate fuel cannot prove whether an individual alert is
already included. No automatic JunkWare, QBO, payment or notification write is
part of this importer. Existing posted-CSV expense automation is unchanged.

A unique one-to-one posted purchase with exactly corroborating local date/time,
merchant street/city/state, driver and gallons links to the same alert record.
Tracking numbers are not assumed to equal posted transaction IDs or receipts.
Posted fuel amount replaces the provisional amount and the difference remains
visible, even when settlement changes the amount. Multiple matches, reversals
versus settlement and distinct tracking numbers at the same driver/station within
30 minutes require review; a repeated alert does not prove another expense.
Incomplete match evidence stays provisional and separate from settled totals.
Existing dated crew/GPS truck attribution is reused only for the exact linked
price evidence; otherwise truck remains unconfirmed. Asset/card labels are not
truck identity. A later source message does not inherit attribution from another
price revision. A missing/corrupt journal, an empty day or a day with no pending
authorizations has an unavailable provisional amount, never a zero-spend claim.
A matched posted purchase with an unknown fuel portion remains under review.
Tracking number is a grouping hint, not proof of global uniqueness: changed
identity across dates or purchases requires review. Nearby declines/reversals
also trigger conservative review rather than assuming a retry is independent.

This is a prepared local ingestion/read model, not a deployed collector. No
recurring agent job is installed. The owner excludes extra Codex/compute jobs,
new charges and new access; the earlier hourly Codex proposal was withdrawn.
An authorized mailbox-to-runtime bridge and release approval remain prerequisites
for ongoing daily ingestion. Synthetic importer and reconciliation tests run in
`npm run verify:wex-fuel` (also in CI); the synthetic browser check is
`node scripts/test-wex-alert-expenses-browser.mjs`.

## Native mail collection adapter

`scripts/collect-wex-local-mail.py` is a deterministic handler for an existing
native mail filesystem-event worker. It installs no service, timer or AI task.
The worker supplies its already-approved Exchange account identity; the scanner
verifies that identity against the local accounts database and reads only WEX
sender messages in that account's eight-day recovery window. Both databases are
opened read-only. Empty plain-text MIME alternatives fall back to HTML. Only
explicit WEX fields are passed to the importer; account/card fields, attachments,
unrelated mail and credentials are excluded. Missing or conflicting bodies are
reported as gaps. Apple Mail must already synchronize the account; this handler
does not establish or refresh mailbox access.

Native provenance retains the RFC Message-ID and account identity in private
`native-mail-evidence.json`. An opaque `outlook-local:` hash identifies this
evidence in the snapshots. The UI labels native evidence without inventing an
Outlook URL. Matching connector/native messages reuse the existing source record,
so startup recovery does not duplicate daily expenses or freshen price evidence.

The shared native importer serializes events and preserves each snapshot's lock
and compare-before-write checks. Daily revisions are retained. A reversal,
uncertain repeated purchase or conflict with an existing price blocks that
tracking number from price selection; it does not overwrite the conflict or
reuse the withdrawn price. Blocks require evidence review rather than automatic
clearing. If a two-snapshot update fails, status remains `apply_failed` and fuel
selection fails closed until a successful replay. Source scan failures preserve
prior source evidence and are visible separately from successful imports. The
seven-day price window still uses source evidence time, never scan/import time.

Finance shows the last native scan, latest received source time, rejected count
and import result. These timestamps do not prove current Exchange synchronization
or receipt of every future email. Activation requires the reviewed native worker
hook to call this handler and exclude WEX from its AI/notification path. Deploying
these files alone does not activate collection. No new credentials, access scopes,
external messages or paid-provider calls are part of this adapter.
