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
